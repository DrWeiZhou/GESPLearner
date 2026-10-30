import { z } from "zod";
import { errorResponse, HttpError, requireUserIfConfigured } from "@/lib/auth";
import { getAnswerKeys, getPaper } from "@/lib/content";
import type { ExamReport, ReportItem } from "@/lib/grading";
import { getOpenAttempt } from "@/lib/records";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answerRecords, attempts, submissions } from "@/db/schema";

const Body = z.object({
  paperId: z.string(),
  attemptId: z.string().uuid().nullish(),
  answers: z.record(z.string(), z.enum(["A", "B", "C", "D", "T", "F"])),
  /** Demo mode only: best judge result per programming question as seen by the client. */
  programming: z.record(z.string(), z.object({ passed: z.number().int().min(0), total: z.number().int().min(0) })).default({}),
});

/** Hand in a mock exam: grade objective answers server-side and score programming by best submission. */
export async function POST(req: Request) {
  try {
    const user = await requireUserIfConfigured();
    const body = Body.parse(await req.json());
    const paper = await getPaper(body.paperId);
    if (!paper) throw new HttpError(404, "试卷不存在");

    let attemptId: string | null = null;
    const bestRuns = new Map<string, { passed: number; total: number }>();

    if (user) {
      if (!body.attemptId) throw new HttpError(400, "缺少考试记录");
      const attempt = await getOpenAttempt(user.id, body.attemptId);
      if (!attempt || attempt.paperId !== paper.id) throw new HttpError(400, "考试已结束或不存在");
      attemptId = attempt.id;

      const subs = await getDb()
        .select({ questionId: submissions.questionId, passed: submissions.passed, total: submissions.total })
        .from(submissions)
        .where(eq(submissions.attemptId, attemptId));
      for (const s of subs) {
        const prev = bestRuns.get(s.questionId);
        if (!prev || s.passed / Math.max(s.total, 1) > prev.passed / Math.max(prev.total, 1))
          bestRuns.set(s.questionId, { passed: s.passed, total: s.total });
      }
    } else {
      for (const [qid, r] of Object.entries(body.programming))
        bestRuns.set(qid, { passed: Math.min(r.passed, r.total), total: r.total });
    }

    const keys = await getAnswerKeys(paper.questions.map((q) => q.id));
    const items: ReportItem[] = paper.questions.map((q) => {
      if (q.type === "programming") {
        const run = bestRuns.get(q.id);
        const earned = run && run.total ? Math.round((q.score * run.passed) / run.total) : 0;
        return {
          questionId: q.id, type: q.type, number: q.number, score: q.score, earned,
          correct: !!run && run.total > 0 && run.passed === run.total,
          studentAnswer: null, correctAnswer: null, passed: run?.passed ?? 0, total: run?.total ?? 0,
        };
      }
      const studentAnswer = body.answers[q.id] ?? null;
      const correctAnswer = keys.get(q.id)?.answer ?? null;
      const correct = studentAnswer !== null && studentAnswer === correctAnswer;
      return {
        questionId: q.id, type: q.type, number: q.number, score: q.score,
        earned: correct ? q.score : 0, correct, studentAnswer, correctAnswer,
      };
    });

    const report: ExamReport = {
      attemptId,
      paperId: paper.id,
      score: items.reduce((s, i) => s + i.earned, 0),
      maxScore: paper.totalScore,
      items,
    };

    if (user && attemptId) {
      const db = getDb();
      const answered = items.filter((i) => i.type !== "programming" && i.studentAnswer !== null);
      await db.transaction(async (tx) => {
        if (answered.length)
          await tx.insert(answerRecords).values(
            answered.map((i) => ({
              userId: user.id, questionId: i.questionId, attemptId,
              answer: i.studentAnswer!, isCorrect: i.correct,
            })),
          );
        await tx
          .update(attempts)
          .set({ submittedAt: new Date(), score: report.score, detail: report })
          .where(eq(attempts.id, attemptId!));
      });
    }

    return Response.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
