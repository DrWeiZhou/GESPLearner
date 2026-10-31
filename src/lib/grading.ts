/** Shared exam-report types (client-safe). */

import type { CoinReward } from "@/lib/types";

export type ReportItem = {
  questionId: string;
  type: "single_choice" | "true_false" | "programming";
  number: number;
  score: number;
  earned: number;
  correct: boolean;
  studentAnswer: string | null;
  correctAnswer: string | null;
  /** programming only */
  passed?: number;
  total?: number;
};

export type ExamReport = {
  attemptId: string | null;
  paperId: string;
  score: number;
  maxScore: number;
  items: ReportItem[];
  /** Coins the hand-in settled, or null when every question had already paid out. */
  coins?: CoinReward | null;
};
