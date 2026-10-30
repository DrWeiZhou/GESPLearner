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
  uniqueIndex,
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

/**
 * Accounts live here, not in Supabase Auth: GESP students are children who often
 * have no mailbox, so they sign in with a username and password. Supabase is used
 * purely as the Postgres host.
 *
 * `passwordHash` is a self-describing scrypt string (see `@/lib/password`), never
 * a raw password. Usernames are compared case-insensitively.
 */
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    username: text().notNull(),
    passwordHash: text().notNull(),
    displayName: text(),
    role: text({ enum: ["student", "admin"] }).notNull().default("student"),
    targetLevel: smallint(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp({ withTimezone: true }),
    /** Throttling for password guessing. */
    failedAttempts: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("users_username_key").on(sql`lower(${t.username})`)],
);

/**
 * Server-side sessions. Only the SHA-256 of the cookie token is stored, so a
 * database leak doesn't hand out live sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
);

/** Single-row-per-key configuration, editable by an admin (e.g. the coin rate). */
export const appSettings = pgTable("app_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid().references(() => users.id, { onDelete: "set null" }),
});

export const DEFAULT_COIN_RATE = 0.3;
export const COIN_RATE_KEY = "coin_rate";

export const attempts = pgTable(
  "attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    messages: jsonb().$type<StoredChatMessage[]>().notNull().default([]),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.questionId)],
);

/**
 * Coin ledger. The balance is the SUM of amounts rather than a stored counter, so
 * every change is auditable and concurrent writes can't lose an update.
 *
 * - `earn`:  redeeming a finished attempt (floor(score × rate)), positive
 * - `spend`: coins deducted when the student cashes them in, negative
 * - `adjust`: manual correction by an admin, either sign
 */
export const coinTransactions = pgTable(
  "coin_transactions",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid().notNull(),
    /** Positive = credit, negative = debit. Whole coins only. */
    amount: integer().notNull(),
    type: text({ enum: ["earn", "spend", "adjust"] }).notNull(),
    attemptId: uuid().references(() => attempts.id, { onDelete: "set null" }),
    note: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.userId, t.createdAt),
    // One redemption per attempt — enforced by the database, not just the route.
    uniqueIndex("coin_tx_one_earn_per_attempt")
      .on(t.attemptId)
      .where(sql`${t.type} = 'earn'`),
  ],
);
