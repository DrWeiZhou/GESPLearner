import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ExamReport } from "@/lib/grading";

/**
 * Database schema (SQLite, one file in the user's data directory), managed by
 * drizzle-kit. The desktop app is the only client, so authorization lives in the
 * server code exactly as it did on Postgres.
 *
 * Postgres → SQLite mapping:
 * - timestamps are integer milliseconds (`timestamp_ms`), surfacing as `Date`
 * - uuid ids are text, generated in JS with `crypto.randomUUID()`
 * - jsonb is text in JSON mode, numeric is REAL (coin amounts are rounded to three
 *   decimals in code, see lib/coins), boolean is 0/1
 * - the pgvector embedding is a Float32 BLOB; similarity is computed in memory
 */

export const EMBEDDING_DIMENSIONS = 1024;

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const timestamp = () => integer({ mode: "timestamp_ms" });
const bool = () => integer({ mode: "boolean" });

/** number[] ↔ little-endian Float32 BLOB (4 KB per 1024-dim vector). */
const vector = customType<{ data: number[]; driverData: Uint8Array }>({
  dataType: () => "blob",
  toDriver: (value) => new Uint8Array(Float32Array.from(value).buffer),
  fromDriver: (value) => {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
    // Copy so the Float32Array view is aligned regardless of the driver's buffer.
    return Array.from(new Float32Array(bytes.slice().buffer));
  },
});

// ───────────────────────── Content ─────────────────────────

export const exams = sqliteTable("exams", {
  id: text().primaryKey(), // '2026-09'
  title: text().notNull(), // '2026年9月GESP认证'
  sourceUrl: text(),
  createdAt: createdAt(),
});

export const papers = sqliteTable(
  "papers",
  {
    id: text().primaryKey(), // 'cpp-2026-09-l3'
    examId: text()
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    language: text().notNull().default("cpp"),
    level: integer().notNull(),
    pdfUrl: text(),
    durationMinutes: integer().notNull().default(120),
    /** crawled: PDF known · parsed: imported, awaiting review · published: visible to students */
    status: text({ enum: ["crawled", "parsed", "published"] }).notNull().default("crawled"),
    totalScore: real().notNull().default(0),
    updatedAt: createdAt(),
  },
  (t) => [
    unique().on(t.examId, t.language, t.level),
    index("papers_language_level_idx").on(t.language, t.level),
    check("papers_level_range", sql`${t.level} between 1 and 8`),
  ],
);

export type SampleJson = { input: string; output: string; explanation?: string };
export type OptionJson = { label: "A" | "B" | "C" | "D"; content: string };

export const questions = sqliteTable(
  "questions",
  {
    id: text().primaryKey(), // 'cpp-2026-09-l3-sc-01'
    paperId: text()
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    type: text({ enum: ["single_choice", "true_false", "programming"] }).notNull(),
    number: integer().notNull(),
    score: real().notNull(),
    /** Markdown. For programming questions this is the problem description. */
    stem: text().notNull().default(""),
    options: text({ mode: "json" }).$type<OptionJson[]>(),
    // programming only
    title: text(),
    timeLimitMs: integer(),
    memoryLimitMb: integer(),
    inputFormat: text(),
    outputFormat: text(),
    samples: text({ mode: "json" }).$type<SampleJson[]>(),
    dataRange: text(),
    sortOrder: integer().notNull().default(0),
    /** Semantic embedding of the question text, for similar-question search / tutor RAG. */
    embedding: vector(),
  },
  (t) => [
    unique().on(t.paperId, t.type, t.number),
    index("questions_paper_sort_idx").on(t.paperId, t.sortOrder),
  ],
);

/** Server-only: answers and reference solutions. */
export const questionKeys = sqliteTable("question_keys", {
  questionId: text()
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  answer: text(), // 'A'..'D' | 'T' | 'F'
  explanation: text(),
  referenceSolution: text(),
});

/** Server-only: judge data (samples + hidden cases). */
export const testCases = sqliteTable(
  "test_cases",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    idx: integer().notNull(),
    input: text().notNull(),
    expectedOutput: text().notNull(),
    isSample: bool().notNull().default(false),
  },
  (t) => [unique().on(t.questionId, t.idx)],
);

/**
 * The official syllabus (《CCF 编程能力等级认证标准》), one row per C++ level.
 *
 * All eight levels live in a single official PDF; `pages` records which slice of it
 * this row was parsed from, so a bad transcription can be traced back.
 */
export const syllabi = sqliteTable(
  "syllabi",
  {
    level: integer().primaryKey(),
    language: text().notNull().default("cpp"),
    /** 考核目标 for the level, as printed in the syllabus. */
    objective: text().notNull().default(""),
    pdfUrl: text(),
    sourceUrl: text(),
    /** 1-based [from, to] page range inside the official PDF. */
    pages: text({ mode: "json" }).$type<[number, number]>(),
    updatedAt: createdAt(),
  },
  (t) => [check("syllabi_level_range", sql`${t.level} between 1 and 8`)],
);

/**
 * A single examinable topic, e.g. 三级「位运算」. Ids are derived from the level and
 * the name (see `knowledgePointId`) so re-parsing the syllabus keeps the ids of
 * points that haven't changed, and with them the question classifications.
 */
export const knowledgePoints = sqliteTable(
  "knowledge_points",
  {
    id: text().primaryKey(), // 'kp-l3-1a2b3c4d'
    level: integer()
      .notNull()
      .references(() => syllabi.level, { onDelete: "cascade" }),
    /** 知识块 the point belongs to. */
    block: text().notNull(),
    name: text().notNull(),
    summary: text().notNull().default(""),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index("knowledge_points_level_sort_idx").on(t.level, t.sortOrder)],
);

/**
 * Which knowledge point a question examines, decided by the LLM the first time a
 * student gets the question wrong and then reused for everyone — the verdict is a
 * property of the question, not of who missed it.
 *
 * A null `knowledgePointId` means the model was asked and couldn't place the
 * question; the row still exists, so it isn't asked again on every page load.
 */
export const questionKnowledge = sqliteTable("question_knowledge", {
  questionId: text()
    .primaryKey()
    .references(() => questions.id, { onDelete: "cascade" }),
  knowledgePointId: text().references(() => knowledgePoints.id, { onDelete: "cascade" }),
  /** One line of the model's reasoning, shown to the student in the wrong-answer book. */
  reason: text(),
  /** Which model decided, so old verdicts stay explainable after a model change. */
  model: text(),
  createdAt: createdAt(),
});

// ───────────────────────── Users ─────────────────────────

/**
 * Accounts: GESP students are children who often have no mailbox, so they sign in
 * with a username and password. Several students can share one installation.
 *
 * `passwordHash` is a self-describing scrypt string (see `@/lib/password`), never
 * a raw password. Usernames are compared case-insensitively.
 */
export const users = sqliteTable(
  "users",
  {
    id: id(),
    username: text().notNull(),
    passwordHash: text().notNull(),
    displayName: text(),
    role: text({ enum: ["student", "admin"] }).notNull().default("student"),
    targetLevel: integer(),
    createdAt: createdAt(),
    lastLoginAt: timestamp(),
    /** Throttling for password guessing. */
    failedAttempts: integer().notNull().default(0),
    lockedUntil: timestamp(),
  },
  (t) => [uniqueIndex("users_username_key").on(sql`lower(${t.username})`)],
);

/**
 * Server-side sessions. Only the SHA-256 of the cookie token is stored, so a
 * database leak doesn't hand out live sessions.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text().notNull().unique(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Single-row-per-key configuration, editable by an admin (e.g. the coin rate). */
export const appSettings = sqliteTable("app_settings", {
  key: text().primaryKey(),
  value: text({ mode: "json" }).notNull(),
  updatedAt: createdAt(),
  updatedBy: text().references(() => users.id, { onDelete: "set null" }),
});

export const DEFAULT_COIN_RATE = 0.3;
export const COIN_RATE_KEY = "coin_rate";
/** LLM endpoint set from /admin; the API key inside is encrypted (see lib/secret-box). */
export const AI_SETTINGS_KEY = "ai_settings";
/** Code runner choice set from /admin (see lib/judge/settings). */
export const JUDGE_SETTINGS_KEY = "judge_settings";
/** Version of the bundled question bank last imported (see db/bootstrap). */
export const CONTENT_VERSION_KEY = "content_version";

export const attempts = sqliteTable(
  "attempts",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paperId: text()
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    mode: text({ enum: ["practice", "exam"] }).notNull(),
    startedAt: createdAt(),
    submittedAt: timestamp(),
    score: real(),
    maxScore: real(),
    detail: text({ mode: "json" }).$type<ExamReport>(),
  },
  (t) => [index("attempts_user_started_idx").on(t.userId, t.startedAt)],
);

export const answerRecords = sqliteTable(
  "answer_records",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    attemptId: text().references(() => attempts.id, { onDelete: "set null" }),
    answer: text().notNull(),
    isCorrect: bool().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("answer_records_user_question_idx").on(t.userId, t.questionId, t.createdAt)],
);

export type CaseSummaryJson = { idx: number; isSample: boolean; verdict: string; timeMs: number | null; memoryKb: number | null };

export const submissions = sqliteTable(
  "submissions",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    attemptId: text().references(() => attempts.id, { onDelete: "set null" }),
    code: text().notNull(),
    language: text().notNull().default("cpp"),
    verdict: text().notNull(), // AC / WA / TLE / MLE / RE / CE / SE
    passed: integer().notNull().default(0),
    total: integer().notNull().default(0),
    results: text({ mode: "json" }).$type<CaseSummaryJson[]>(),
    compileOutput: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("submissions_user_question_idx").on(t.userId, t.questionId, t.createdAt),
    index("submissions_attempt_idx").on(t.attemptId),
  ],
);

export type StoredChatMessage = { id: string; role: "user" | "assistant"; text: string };

export const aiChats = sqliteTable(
  "ai_chats",
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    messages: text({ mode: "json" }).$type<StoredChatMessage[]>().notNull().default(sql`'[]'`),
    updatedAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.questionId)],
);

/**
 * One row per (student, question) as soon as the question is first graded — the
 * record that it has been settled, whether or not it paid anything. The composite
 * primary key is what makes a redo earn nothing, including a second pass through
 * the wrong-answer book: the row is already there, with the score of that first
 * attempt (0 for a wrong answer).
 */
export const questionRewards = sqliteTable(
  "question_rewards",
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    /** Score earned the first time the question was graded. */
    score: real().notNull(),
    /** The rate in force at that moment, so old rows stay explainable. */
    rate: real().notNull(),
    /** score × rate — what the ledger was credited. Fractional, e.g. 0.6. */
    coins: real().notNull(),
    /** Set when the question was graded as part of a mock exam. */
    attemptId: text().references(() => attempts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.questionId] }),
    index("question_rewards_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Coin ledger. The balance is the SUM of amounts rather than a stored counter, so
 * every change is auditable.
 *
 * Amounts are fractional: a 2-point question at the default rate is worth 0.6 coins,
 * and the student gets exactly that — no rounding, no remainder held back.
 *
 * - `reward`: coins from freshly graded questions (see `questionRewards`), positive
 * - `spend`: coins deducted when the student cashes them in, negative
 * - `adjust`: manual correction by an admin, either sign
 * - `earn`:  legacy whole-paper redemption, kept so old history still reads correctly
 */
export const coinTransactions = sqliteTable(
  "coin_transactions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: text().notNull(),
    /** Positive = credit, negative = debit. Fractional, rounded to three decimals in code. */
    amount: real().notNull(),
    type: text({ enum: ["reward", "spend", "adjust", "earn"] }).notNull(),
    attemptId: text().references(() => attempts.id, { onDelete: "set null" }),
    /** Set when the row is the reward for a single question. */
    questionId: text().references(() => questions.id, { onDelete: "set null" }),
    note: text(),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("coin_tx_user_created_idx").on(t.userId, t.createdAt),
    // Legacy: guarded the old one-redemption-per-paper flow.
    uniqueIndex("coin_tx_one_earn_per_attempt")
      .on(t.attemptId)
      .where(sql`${t.type} = 'earn'`),
  ],
);
