/** Client-safe types: nothing here may carry answers, reference solutions or hidden tests. */

import type { Option, QuestionType } from "@/lib/schema/paper";

export type PublicSingleChoice = {
  id: string;
  type: "single_choice";
  number: number;
  score: number;
  stem: string;
  options: Option[];
};

export type PublicTrueFalse = {
  id: string;
  type: "true_false";
  number: number;
  score: number;
  stem: string;
};

export type PublicProgramming = {
  id: string;
  type: "programming";
  number: number;
  score: number;
  title: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  description: string;
  inputFormat: string;
  outputFormat: string;
  samples: { input: string; output: string; explanation?: string }[];
  dataRange?: string;
};

export type PublicQuestion = PublicSingleChoice | PublicTrueFalse | PublicProgramming;
export type ObjectiveQuestion = PublicSingleChoice | PublicTrueFalse;

export type PaperSummary = {
  id: string;
  examId: string;
  examTitle: string;
  level: number;
  language: "cpp";
  durationMinutes: number;
  totalScore: number;
  counts: Record<QuestionType, number>;
  pdfUrl: string | null;
  sourceUrl: string | null;
};

export type PaperDetail = PaperSummary & { questions: PublicQuestion[] };

export type QuestionWithPaper = {
  paper: PaperSummary;
  question: PublicQuestion;
  prevId: string | null;
  nextId: string | null;
};

// ───────── judge ─────────

export type Verdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "SE";

export type RunResult = {
  status: "OK" | Exclude<Verdict, "AC" | "WA">;
  stdout: string;
  stderr: string;
  compileOutput: string;
  timeMs: number | null;
  memoryKb: number | null;
  message?: string;
};

export type CaseResult = {
  idx: number;
  isSample: boolean;
  verdict: Verdict;
  timeMs: number | null;
  memoryKb: number | null;
  /** Revealed for samples and for the first failing case (truncated) to aid learning. */
  input?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
};

export type JudgeResult = {
  verdict: Verdict;
  passed: number;
  total: number;
  cases: CaseResult[];
  compileOutput: string;
  /** Score earned on this question (passed / total × full score). */
  score?: number;
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  AC: "通过",
  WA: "答案错误",
  TLE: "运行超时",
  MLE: "内存超限",
  RE: "运行错误",
  CE: "编译错误",
  SE: "评测系统错误",
};

// ───────── coins ─────────

/**
 * Coins settled for one or more freshly graded questions (see `lib/coins`). A
 * question pays once, so a redo returns null instead of this.
 */
export type CoinReward = {
  /** Exact coins the questions earned — score × rate, usually fractional. */
  coins: number;
  /** Whole coins credited to the balance right now. */
  credited: number;
  /** Fraction left over, waiting for the next question. Always < 1. */
  carry: number;
  /** Balance after crediting. */
  balance: number;
  /** How many questions this settlement covered. */
  questions: number;
};

// ───────── AI tutor ─────────

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type TutorContext =
  | { kind: "objective"; answer: string | null }
  | { kind: "programming"; code: string; judge?: JudgeResult | null };
