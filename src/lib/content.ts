import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import { and, asc, cosineDistance, count, eq, getTableColumns, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/db";
import { exams, papers, questionKeys, questions, testCases } from "@/db/schema";
import { PaperSchema, questionId, type Paper, type QuestionType } from "@/lib/schema/paper";
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
 * Source: Postgres via Drizzle when DATABASE_URL is set, otherwise `data/papers/*.json` (demo mode).
 */

const DATA_DIR = path.join(process.cwd(), "data");

// ───────────────────────── local JSON source ─────────────────────────

async function loadLocalPapers(): Promise<Paper[]> {
  const dir = path.join(DATA_DIR, "papers");
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const papers = await Promise.all(
    files.map(async (f) => PaperSchema.parse(JSON.parse(await readFile(path.join(dir, f), "utf8")))),
  );
  return papers;
}

function toPublicQuestions(paper: Paper): PublicQuestion[] {
  return paper.questions.map((q) => {
    const id = questionId(paper.id, q);
    switch (q.type) {
      case "single_choice":
        return { id, type: q.type, number: q.number, score: q.score, stem: q.stem, options: q.options };
      case "true_false":
        return { id, type: q.type, number: q.number, score: q.score, stem: q.stem };
      case "programming":
        return {
          id,
          type: q.type,
          number: q.number,
          score: q.score,
          title: q.title,
          timeLimitMs: q.timeLimitMs,
          memoryLimitMb: q.memoryLimitMb,
          description: q.description,
          inputFormat: q.inputFormat,
          outputFormat: q.outputFormat,
          samples: q.samples,
          dataRange: q.dataRange,
        };
    }
  });
}

function summarize(paper: Paper): PaperSummary {
  const counts = { single_choice: 0, true_false: 0, programming: 0 } satisfies Record<QuestionType, number>;
  for (const q of paper.questions) counts[q.type]++;
  return {
    id: paper.id,
    examId: paper.exam.id,
    examTitle: paper.exam.title,
    level: paper.level,
    language: paper.language,
    durationMinutes: paper.durationMinutes,
    totalScore: paper.questions.reduce((s, q) => s + q.score, 0),
    counts,
    pdfUrl: paper.pdfUrl ?? null,
    sourceUrl: paper.exam.sourceUrl ?? null,
  };
}

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

  let list: PaperSummary[];
  if (isDatabaseConfigured) {
    list = await selectPapers(eq(papers.status, "published"));
  } else {
    list = (await loadLocalPapers()).map(summarize);
  }
  return list.sort((a, b) => b.examId.localeCompare(a.examId) || a.level - b.level);
}

export async function getPaper(id: string): Promise<PaperDetail | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("papers", `paper:${id}`);

  if (isDatabaseConfigured) {
    const [summary] = await selectPapers(and(eq(papers.id, id), eq(papers.status, "published"))!);
    if (!summary) return null;
    const rows = await getDb()
      .select(publicQuestionColumns)
      .from(questions)
      .where(eq(questions.paperId, id))
      .orderBy(asc(questions.sortOrder));
    return { ...summary, questions: rows.map((r) => rowToQuestion(r as QuestionRow)) };
  }

  const paper = (await loadLocalPapers()).find((p) => p.id === id);
  return paper ? { ...summarize(paper), questions: toPublicQuestions(paper) } : null;
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

  if (isDatabaseConfigured) {
    const rows = await getDb().select().from(questionKeys).where(inArray(questionKeys.questionId, ids));
    for (const r of rows)
      keys.set(r.questionId, { answer: r.answer, explanation: r.explanation, referenceSolution: r.referenceSolution });
    return keys;
  }

  const wanted = new Set(ids);
  for (const paper of await loadLocalPapers()) {
    for (const q of paper.questions) {
      const id = questionId(paper.id, q);
      if (!wanted.has(id)) continue;
      keys.set(id, {
        answer: q.type === "programming" ? null : q.answer,
        explanation: q.type === "programming" ? null : (q.explanation ?? null),
        referenceSolution: q.type === "programming" ? (q.referenceSolution ?? null) : null,
      });
    }
  }
  return keys;
}

export type TestCase = { idx: number; input: string; expectedOutput: string; isSample: boolean };

/** Samples first, then hidden cases. Falls back to samples only when no tests were generated. */
export async function getTestCases(qid: string): Promise<TestCase[]> {
  if (isDatabaseConfigured) {
    const rows = await getDb()
      .select({ idx: testCases.idx, input: testCases.input, expectedOutput: testCases.expectedOutput, isSample: testCases.isSample })
      .from(testCases)
      .where(eq(testCases.questionId, qid))
      .orderBy(asc(testCases.idx));
    if (rows.length > 0) return rows;
  } else {
    try {
      const file = path.join(DATA_DIR, "tests", `${qid}.json`);
      const cases = JSON.parse(await readFile(file, "utf8")) as TestCase[];
      if (cases.length > 0) return cases;
    } catch {
      // no generated tests yet
    }
  }

  const found = await getQuestion(qid);
  if (found?.question.type !== "programming") return [];
  return found.question.samples.map((s, idx) => ({
    idx,
    input: s.input,
    expectedOutput: s.output,
    isSample: true,
  }));
}

// ───────────────────────── similarity (pgvector) ─────────────────────────

export type SimilarQuestion = {
  id: string;
  paperId: string;
  type: QuestionType;
  number: number;
  title: string | null;
  stem: string;
  similarity: number;
};

/**
 * Nearest questions by embedding (cosine), from other published papers.
 * Returns [] in demo mode or before `scripts/embed.ts` has run.
 */
export async function getSimilarQuestions(qid: string, limit = 4): Promise<SimilarQuestion[]> {
  "use cache";
  cacheLife("days");
  cacheTag("papers", `similar:${qid}`);
  if (!isDatabaseConfigured) return [];

  const db = getDb();
  const [target] = await db
    .select({ embedding: questions.embedding, paperId: questions.paperId })
    .from(questions)
    .where(eq(questions.id, qid));
  if (!target?.embedding) return [];

  const distance = cosineDistance(questions.embedding, target.embedding);
  const rows = await db
    .select({
      id: questions.id,
      paperId: questions.paperId,
      type: questions.type,
      number: questions.number,
      title: questions.title,
      stem: questions.stem,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(questions)
    .innerJoin(papers, eq(papers.id, questions.paperId))
    .where(and(isNotNull(questions.embedding), ne(questions.paperId, target.paperId), eq(papers.status, "published")))
    .orderBy(distance)
    .limit(limit);
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}
