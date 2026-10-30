import "server-only";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerRecords, attempts, papers, questions, submissions } from "@/db/schema";

/** Per-user learning statistics. Always read fresh (no caching of personal data). */

export type OverviewStats = {
  answered: number;
  correct: number;
  accuracy: number;
  submissions: number;
  acSubmissions: number;
  examCount: number;
};

export async function getOverview(userId: string): Promise<OverviewStats> {
  const db = getDb();
  // Sequential — concurrent queries inside a Server Component render leave the
  // Suspense boundary unresolved on Vercel; see app/coins/page.tsx.
  const [ans] = await (db
      .select({
        answered: count(),
        correct: sql<number>`count(*) filter (where ${answerRecords.isCorrect})`,
      })
      .from(answerRecords)
      .where(eq(answerRecords.userId, userId)));
  const [subs] = await (db
      .select({
        total: count(),
        ac: sql<number>`count(*) filter (where ${submissions.verdict} = 'AC')`,
      })
      .from(submissions)
      .where(eq(submissions.userId, userId)));
  const [exams] = await (db
      .select({ n: count() })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), sql`${attempts.submittedAt} is not null`)));

  const answered = Number(ans?.answered ?? 0);
  const correct = Number(ans?.correct ?? 0);
  return {
    answered,
    correct,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
    submissions: Number(subs?.total ?? 0),
    acSubmissions: Number(subs?.ac ?? 0),
    examCount: Number(exams?.n ?? 0),
  };
}

export type LevelStat = { level: number; answered: number; correct: number };

export async function getAccuracyByLevel(userId: string): Promise<LevelStat[]> {
  const rows = await getDb()
    .select({
      level: papers.level,
      answered: count(),
      correct: sql<number>`count(*) filter (where ${answerRecords.isCorrect})`,
    })
    .from(answerRecords)
    .innerJoin(questions, eq(questions.id, answerRecords.questionId))
    .innerJoin(papers, eq(papers.id, questions.paperId))
    .where(eq(answerRecords.userId, userId))
    .groupBy(papers.level)
    .orderBy(papers.level);
  return rows.map((r) => ({ level: r.level, answered: Number(r.answered), correct: Number(r.correct) }));
}

export type RecentAttempt = {
  id: string;
  paperId: string;
  level: number;
  examId: string;
  score: number | null;
  maxScore: number | null;
  submittedAt: Date | null;
};

export async function getRecentAttempts(userId: string, limit = 10): Promise<RecentAttempt[]> {
  return getDb()
    .select({
      id: attempts.id,
      paperId: attempts.paperId,
      level: papers.level,
      examId: papers.examId,
      score: attempts.score,
      maxScore: attempts.maxScore,
      submittedAt: attempts.submittedAt,
    })
    .from(attempts)
    .innerJoin(papers, eq(papers.id, attempts.paperId))
    .where(and(eq(attempts.userId, userId), sql`${attempts.submittedAt} is not null`))
    .orderBy(desc(attempts.submittedAt))
    .limit(limit);
}

export type WrongItem = {
  questionId: string;
  type: "single_choice" | "true_false" | "programming";
  number: number;
  stem: string;
  title: string | null;
  level: number;
  examId: string;
  wrongCount: number;
  lastWrongAt: Date;
  /** True once the student later answered the same question correctly. */
  resolved: boolean;
};

/** Wrong-answer book: objective questions the student has got wrong at least once. */
export async function getWrongQuestions(userId: string, limit = 100): Promise<WrongItem[]> {
  const rows = await getDb()
    .select({
      questionId: answerRecords.questionId,
      type: questions.type,
      number: questions.number,
      stem: questions.stem,
      title: questions.title,
      level: papers.level,
      examId: papers.examId,
      wrongCount: sql<number>`count(*) filter (where not ${answerRecords.isCorrect})`,
      lastWrongAt: sql<Date>`max(${answerRecords.createdAt}) filter (where not ${answerRecords.isCorrect})`,
      correctCount: sql<number>`count(*) filter (where ${answerRecords.isCorrect})`,
      lastCorrectAt: sql<Date | null>`max(${answerRecords.createdAt}) filter (where ${answerRecords.isCorrect})`,
    })
    .from(answerRecords)
    .innerJoin(questions, eq(questions.id, answerRecords.questionId))
    .innerJoin(papers, eq(papers.id, questions.paperId))
    .where(eq(answerRecords.userId, userId))
    .groupBy(answerRecords.questionId, questions.type, questions.number, questions.stem, questions.title, papers.level, papers.examId)
    .having(gt(sql`count(*) filter (where not ${answerRecords.isCorrect})`, 0))
    .orderBy(desc(sql`max(${answerRecords.createdAt}) filter (where not ${answerRecords.isCorrect})`))
    .limit(limit);

  return rows.map((r) => ({
    questionId: r.questionId,
    type: r.type,
    number: r.number,
    stem: r.stem,
    title: r.title,
    level: r.level,
    examId: r.examId,
    wrongCount: Number(r.wrongCount),
    lastWrongAt: new Date(r.lastWrongAt),
    resolved: r.lastCorrectAt !== null && new Date(r.lastCorrectAt) > new Date(r.lastWrongAt),
  }));
}
