import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, count, eq, getTableColumns, inArray, isNotNull, ne, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { exams, papers, questionKeys, questions, testCases } from "@/db/schema";
import type { QuestionType } from "@/lib/schema/paper";
import type {
  PaperDetail,
  PaperSummary,
  PublicQuestion,
  QuestionWithPaper,
} from "@/lib/types";

/**
 * Content repository. Public getters return question data WITHOUT answers and are
 * cached (`use cache`); answer keys and test cases are only exposed through the
 * server-only private getters at the bottom.
 *
 * Source: the SQLite database, which is filled from the bundled `data/papers/*.json`
 * on first start (see db/bootstrap).
 */

// ───────────────────────── database source ─────────────────────────

type QuestionRow = typeof questions.$inferSelect;
type PaperRow = typeof papers.$inferSelect & { examTitle: string | null; examSourceUrl: string | null };

function rowToQuestion(r: QuestionRow): PublicQuestion {
  const base = { id: r.id, number: r.number, score: r.score };
  if (r.type === "single_choice") return { ...base, type: r.type, stem: r.stem, options: r.options ?? [] };
  if (r.type === "true_false") return { ...base, type: r.type, stem: r.stem };
  return {
    ...base,
    type: "programming",
    title: r.title ?? "",
    timeLimitMs: r.timeLimitMs ?? 1000,
    memoryLimitMb: r.memoryLimitMb ?? 512,
    description: r.stem,
    inputFormat: r.inputFormat ?? "",
    outputFormat: r.outputFormat ?? "",
    samples: r.samples ?? [],
    dataRange: r.dataRange ?? undefined,
  };
}

function rowToSummary(r: PaperRow, counts: Record<QuestionType, number>): PaperSummary {
  return {
    id: r.id,
    examId: r.examId,
    examTitle: r.examTitle ?? r.examId,
    level: r.level,
    language: "cpp",
    durationMinutes: r.durationMinutes,
    totalScore: r.totalScore,
    counts,
    pdfUrl: r.pdfUrl,
    sourceUrl: r.examSourceUrl,
  };
}

async function selectPapers(where: SQL) {
  const db = getDb();
  const rows = await db
    .select({ ...getTableColumns(papers), examTitle: exams.title, examSourceUrl: exams.sourceUrl })
    .from(papers)
    .leftJoin(exams, eq(papers.examId, exams.id))
    .where(where);
  if (rows.length === 0) return [];
  const countRows = await db
    .select({ paperId: questions.paperId, type: questions.type, n: count() })
    .from(questions)
    .where(inArray(questions.paperId, rows.map((r) => r.id)))
    .groupBy(questions.paperId, questions.type);
  return rows.map((r) => {
    const counts = { single_choice: 0, true_false: 0, programming: 0 };
    for (const c of countRows) if (c.paperId === r.id) counts[c.type] = c.n;
    return rowToSummary(r, counts);
  });
}

// Everything except the embedding vector.
const publicQuestionColumns = (() => {
  const { embedding, ...rest } = getTableColumns(questions);
  void embedding;
  return rest;
})();

// ───────────────────────── public getters (cached) ─────────────────────────

export async function listPapers(): Promise<PaperSummary[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("papers");

  const list = await selectPapers(eq(papers.status, "published"));
  return list.sort((a, b) => b.examId.localeCompare(a.examId) || a.level - b.level);
}

export async function getPaper(id: string): Promise<PaperDetail | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("papers", `paper:${id}`);

  const [summary] = await selectPapers(and(eq(papers.id, id), eq(papers.status, "published"))!);
  if (!summary) return null;
  const rows = await getDb()
    .select(publicQuestionColumns)
    .from(questions)
    .where(eq(questions.paperId, id))
    .orderBy(asc(questions.sortOrder));
  return { ...summary, questions: rows.map((r) => rowToQuestion(r as QuestionRow)) };
}

export function paperIdOf(questionId: string) {
  return questionId.replace(/-(sc|tf|pg)-\d+$/, "");
}

export async function getQuestion(id: string): Promise<QuestionWithPaper | null> {
  const paper = await getPaper(paperIdOf(id));
  const question = paper?.questions.find((q) => q.id === id);
  if (!paper || !question) return null;
  const { questions, ...summary } = paper;
  const index = questions.findIndex((q) => q.id === id);
  return {
    paper: summary,
    question,
    prevId: questions[index - 1]?.id ?? null,
    nextId: questions[index + 1]?.id ?? null,
  };
}

// ───────────────────────── private getters (server only, never cached into the client) ─────────────────────────

export type AnswerKey = {
  answer: string | null;
  explanation: string | null;
  referenceSolution: string | null;
};

export async function getAnswerKeys(ids: string[]): Promise<Map<string, AnswerKey>> {
  const keys = new Map<string, AnswerKey>();
  if (ids.length === 0) return keys;

  const rows = await getDb().select().from(questionKeys).where(inArray(questionKeys.questionId, ids));
  for (const r of rows)
    keys.set(r.questionId, { answer: r.answer, explanation: r.explanation, referenceSolution: r.referenceSolution });
  return keys;
}

export type TestCase = { idx: number; input: string; expectedOutput: string; isSample: boolean };

/** Samples first, then hidden cases. Falls back to samples only when no tests were generated. */
export async function getTestCases(qid: string): Promise<TestCase[]> {
  const rows = await getDb()
    .select({ idx: testCases.idx, input: testCases.input, expectedOutput: testCases.expectedOutput, isSample: testCases.isSample })
    .from(testCases)
    .where(eq(testCases.questionId, qid))
    .orderBy(asc(testCases.idx));
  if (rows.length > 0) return rows;

  const found = await getQuestion(qid);
  if (found?.question.type !== "programming") return [];
  return found.question.samples.map((s, idx) => ({
    idx,
    input: s.input,
    expectedOutput: s.output,
    isSample: true,
  }));
}

// ───────────────────────── similarity (embeddings) ─────────────────────────

export type SimilarQuestion = {
  id: string;
  paperId: string;
  type: QuestionType;
  number: number;
  title: string | null;
  stem: string;
  similarity: number;
};

function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Nearest questions by embedding (cosine), from other published papers.
 * Returns [] before the embeddings have been generated (/admin →「生成题目向量」).
 *
 * The bank is a few thousand questions, so a linear scan over the vectors is a
 * few milliseconds — no vector index needed — and the result is cached anyway.
 */
export async function getSimilarQuestions(qid: string, limit = 4): Promise<SimilarQuestion[]> {
  "use cache";
  cacheLife("days");
  cacheTag("papers", `similar:${qid}`);

  const db = getDb();
  const [target] = await db
    .select({ embedding: questions.embedding, paperId: questions.paperId })
    .from(questions)
    .where(eq(questions.id, qid));
  if (!target?.embedding) return [];

  const rows = await db
    .select({
      id: questions.id,
      paperId: questions.paperId,
      type: questions.type,
      number: questions.number,
      title: questions.title,
      stem: questions.stem,
      embedding: questions.embedding,
    })
    .from(questions)
    .innerJoin(papers, eq(papers.id, questions.paperId))
    .where(and(isNotNull(questions.embedding), ne(questions.paperId, target.paperId), eq(papers.status, "published")));

  return rows
    .filter((r) => r.embedding?.length === target.embedding!.length)
    .map(({ embedding, ...r }) => ({ ...r, similarity: cosine(target.embedding!, embedding!) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
