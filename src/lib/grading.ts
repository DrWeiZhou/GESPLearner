/** Shared exam-report types (client-safe). */

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
};
