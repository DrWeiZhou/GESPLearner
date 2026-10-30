import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { ExamReport } from "@/lib/grading";

/**
 * Database schema (Supabase Postgres + pgvector), managed by drizzle-kit.
 *
 * The app talks to Postgres directly through Drizzle on the server, so every table
 * has RLS enabled with no policies (see the custom migration): Supabase's public
 * REST API can't read anything, and authorization lives in the server code.
 *
 * User ids are Supabase Auth ids (auth.users.id). We deliberately don't declare a
 * foreign key into the `auth` schema so migrations also run on plain Postgres.
 */

export const EMBEDDING_DIMENSIONS = 1024;

// ───────────────────────── Content ─────────────────────────

export const exams = pgTable("exams", {
  id: text().primaryKey(), // '2026-09'
  title: text().notNull(), // '2026年9月GESP认证'
  sourceUrl: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const papers = pgTable(
  "papers",
  {
    id: text().primaryKey(), // 'cpp-2026-09-l3'
    examId: text()
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    language: text().notNull().default("cpp"),
    level: smallint().notNull(),
    pdfUrl: text(),
    durationMinutes: integer().notNull().default(120),
    /** crawled: PDF known · parsed: imported, awaiting review · published: visible to students */
    status: text({ enum: ["crawled", "parsed", "published"] }).notNull().default("crawled"),
    totalScore: numeric({ mode: "number" }).notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.examId, t.language, t.level),
    index().on(t.language, t.level),
    check("papers_level_range", sql`${t.level} between 1 and 8`),
  ],
);

export type SampleJson = { input: string; output: string; explanation?: string };
export type OptionJson = { label: "A" | "B" | "C" | "D"; content: string };

export const questions = pgTable(
  "questions",
  {
    id: text().primaryKey(), // 'cpp-2026-09-l3-sc-01'
    paperId: text()
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    type: text({ enum: ["single_choice", "true_false", "programming"] }).notNull(),
    number: smallint().notNull(),
    score: numeric({ mode: "number" }).notNull(),
    /** Markdown. For programming questions this is the problem description. */
    stem: text().notNull().default(""),
    options: jsonb().$type<OptionJson[]>(),
    // programming only
    title: text(),
    timeLimitMs: integer(),
    memoryLimitMb: integer(),
    inputFormat: text(),
    outputFormat: text(),
    samples: jsonb().$type<SampleJson[]>(),
    dataRange: text(),
    sortOrder: integer().notNull().default(0),
    /** Semantic embedding of the question text, for similar-question search / tutor RAG. */
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
  },
  (t) => [
    unique().on(t.paperId, t.type, t.number),
    index().on(t.paperId, t.sortOrder),
    index("questions_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/** Server-only: answers and reference solutions. */
export const questionKeys = pgTable("question_keys", {
  questionId: text()
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  answer: text(), // 'A'..'D' | 'T' | 'F'
  explanation: text(),
  referenceSolution: text(),
});

/** Server-only: judge data (samples + hidden cases). */
export const testCases = pgTable(
  "test_cases",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    idx: integer().notNull(),
    input: text().notNull(),
    expectedOutput: text().notNull(),
    isSample: boolean().notNull().default(false),
  },
  (t) => [unique().on(t.questionId, t.idx)],
);

// ───────────────────────── Users ─────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid().primaryKey(), // = auth.users.id
  displayName: text(),
  role: text({ enum: ["student", "admin"] }).notNull().default("student"),
  targetLevel: smallint(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const attempts = pgTable(
  "attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull(),
    paperId: text()
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    mode: text({ enum: ["practice", "exam"] }).notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp({ withTimezone: true }),
    score: numeric({ mode: "number" }),
    maxScore: numeric({ mode: "number" }),
    detail: jsonb().$type<ExamReport>(),
  },
  (t) => [index().on(t.userId, t.startedAt)],
);

export const answerRecords = pgTable(
  "answer_records",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid().notNull(),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    attemptId: uuid().references(() => attempts.id, { onDelete: "set null" }),
    answer: text().notNull(),
    isCorrect: boolean().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.questionId, t.createdAt)],
);

export type CaseSummaryJson = { idx: number; isSample: boolean; verdict: string; timeMs: number | null; memoryKb: number | null };

export const submissions = pgTable(
  "submissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull(),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    attemptId: uuid().references(() => attempts.id, { onDelete: "set null" }),
    code: text().notNull(),
    language: text().notNull().default("cpp"),
    verdict: text().notNull(), // AC / WA / TLE / MLE / RE / CE / SE
    passed: integer().notNull().default(0),
    total: integer().notNull().default(0),
    results: jsonb().$type<CaseSummaryJson[]>(),
    compileOutput: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId, t.questionId, t.createdAt), index().on(t.attemptId)],
);

export type StoredChatMessage = { id: string; role: "user" | "assistant"; text: string };

export const aiChats = pgTable(
  "ai_chats",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull(),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    messages: jsonb().$type<StoredChatMessage[]>().notNull().default([]),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.questionId)],
);
