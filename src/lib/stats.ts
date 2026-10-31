import "server-only";
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { answerRecords, attempts, knowledgePoints, papers, questionKnowledge, questions, submissions } from "@/db/schema";

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

export type WrongKnowledge = {
  id: string;
  name: string;
  block: string;
  level: number;
  /** One line from the model on why the question sits here. */
  reason: string | null;
};

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
  /** The syllabus knowledge point this question examines (see lib/knowledge/classify). */
  knowledge: WrongKnowledge | null;
  /** False while the question is still waiting to be judged by the model. */
  classified: boolean;
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
      pointId: knowledgePoints.id,
      pointName: knowledgePoints.name,
      pointBlock: knowledgePoints.block,
      pointLevel: knowledgePoints.level,
      reason: questionKnowledge.reason,
      classifiedAt: questionKnowledge.createdAt,
      wrongCount: sql<number>`count(*) filter (where not ${answerRecords.isCorrect})`,
      lastWrongAt: sql<Date>`max(${answerRecords.createdAt}) filter (where not ${answerRecords.isCorrect})`,
      correctCount: sql<number>`count(*) filter (where ${answerRecords.isCorrect})`,
      lastCorrectAt: sql<Date | null>`max(${answerRecords.createdAt}) filter (where ${answerRecords.isCorrect})`,
    })
    .from(answerRecords)
    .innerJoin(questions, eq(questions.id, answerRecords.questionId))
    .innerJoin(papers, eq(papers.id, questions.paperId))
    .leftJoin(questionKnowledge, eq(questionKnowledge.questionId, answerRecords.questionId))
    .leftJoin(knowledgePoints, eq(knowledgePoints.id, questionKnowledge.knowledgePointId))
    .where(eq(answerRecords.userId, userId))
    .groupBy(
      answerRecords.questionId,
      questions.type,
      questions.number,
      questions.stem,
      questions.title,
      papers.level,
      papers.examId,
      knowledgePoints.id,
      knowledgePoints.name,
      knowledgePoints.block,
      knowledgePoints.level,
      questionKnowledge.reason,
      questionKnowledge.createdAt,
    )
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
    knowledge: r.pointId
      ? { id: r.pointId, name: r.pointName!, block: r.pointBlock!, level: r.pointLevel!, reason: r.reason }
      : null,
    classified: r.classifiedAt !== null,
  }));
}

export type WrongGroup = {
  /** Knowledge point id, or one of the two synthetic buckets below. */
  key: string;
  title: string;
  block: string | null;
  level: number | null;
  items: WrongItem[];
  /** Total wrong answers across the group, not just distinct questions. */
  wrongCount: number;
  mastered: number;
};

export const PENDING_GROUP = "pending";
export const UNMATCHED_GROUP = "unmatched";

/**
 * The wrong-answer book grouped by syllabus knowledge point, weakest topic first:
 * most wrong answers, then most questions.
 *
 * Two buckets sit at the end: questions still queued for the model (`pending`) and
 * questions it couldn't place in the syllabus (`unmatched`).
 */
export async function getWrongBook(userId: string, limit = 100) {
  const items = await getWrongQuestions(userId, limit);
  const groups = new Map<string, WrongGroup>();

  for (const item of items) {
    const key = item.knowledge?.id ?? (item.classified ? UNMATCHED_GROUP : PENDING_GROUP);
    const group =
      groups.get(key) ??
      {
        key,
        title: item.knowledge?.name ?? (key === PENDING_GROUP ? "正在判定知识点" : "未能归入大纲知识点"),
        block: item.knowledge?.block ?? null,
        level: item.knowledge?.level ?? null,
        items: [],
        wrongCount: 0,
        mastered: 0,
      };
    group.items.push(item);
    group.wrongCount += item.wrongCount;
    if (item.resolved) group.mastered++;
    groups.set(key, group);
  }

  const synthetic = (g: WrongGroup) => (g.key === PENDING_GROUP || g.key === UNMATCHED_GROUP ? 1 : 0);
  const sorted = [...groups.values()].sort(
    (a, b) => synthetic(a) - synthetic(b) || b.wrongCount - a.wrongCount || b.items.length - a.items.length,
  );

  return {
    groups: sorted,
    total: items.length,
    /** Questions with no verdict yet — the page asks the server to classify these. */
    pending: items.filter((i) => !i.classified).map((i) => i.questionId),
  };
}

/**
 * How many distinct questions the student has got wrong under each knowledge point
 * of one level, keyed by knowledge point id. Drives the「我的错题」counts on the
 * syllabus page.
 */
export async function wrongCountByKnowledge(userId: string, level: number): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({
      pointId: questionKnowledge.knowledgePointId,
      n: sql<number>`count(distinct ${answerRecords.questionId})`,
    })
    .from(answerRecords)
    .innerJoin(questionKnowledge, eq(questionKnowledge.questionId, answerRecords.questionId))
    .innerJoin(knowledgePoints, eq(knowledgePoints.id, questionKnowledge.knowledgePointId))
    .where(and(eq(answerRecords.userId, userId), eq(answerRecords.isCorrect, false), eq(knowledgePoints.level, level)))
    .groupBy(questionKnowledge.knowledgePointId);
  return new Map(rows.flatMap((r) => (r.pointId ? [[r.pointId, Number(r.n)] as [string, number]] : [])));
}
