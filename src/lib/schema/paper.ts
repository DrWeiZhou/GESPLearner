import { z } from "zod";

/**
 * Canonical shape of one GESP paper (one exam session × one level × one language).
 * Produced by `scripts/parse.ts`, stored in `data/papers/*.json`, seeded into Supabase.
 *
 * Text fields are Markdown: inline math as `$...$`, display math as `$$...$$`,
 * code as fenced blocks (```cpp).
 */

export const OptionSchema = z.object({
  label: z.enum(["A", "B", "C", "D"]),
  content: z.string(),
});

export const SingleChoiceSchema = z.object({
  type: z.literal("single_choice"),
  number: z.number().int().positive(),
  score: z.number().positive(),
  stem: z.string(),
  options: z.array(OptionSchema).length(4),
  answer: z.enum(["A", "B", "C", "D"]),
  explanation: z.string().optional(),
});

export const TrueFalseSchema = z.object({
  type: z.literal("true_false"),
  number: z.number().int().positive(),
  score: z.number().positive(),
  stem: z.string(),
  /** "T" = 正确 (√), "F" = 错误 (×) */
  answer: z.enum(["T", "F"]),
  explanation: z.string().optional(),
});

export const SampleSchema = z.object({
  input: z.string(),
  output: z.string(),
  explanation: z.string().optional(),
});

export const ProgrammingSchema = z.object({
  type: z.literal("programming"),
  number: z.number().int().positive(),
  score: z.number().positive(),
  title: z.string(),
  timeLimitMs: z.number().int().positive().default(1000),
  memoryLimitMb: z.number().int().positive().default(512),
  description: z.string(),
  inputFormat: z.string(),
  outputFormat: z.string(),
  samples: z.array(SampleSchema).min(1),
  dataRange: z.string().optional(),
  referenceSolution: z.string().optional(),
});

export const QuestionSchema = z.discriminatedUnion("type", [
  SingleChoiceSchema,
  TrueFalseSchema,
  ProgrammingSchema,
]);

export const PaperSchema = z.object({
  /** e.g. "cpp-2026-09-l3" */
  id: z.string(),
  language: z.literal("cpp"),
  level: z.number().int().min(1).max(8),
  exam: z.object({
    /** e.g. "2026-09" */
    id: z.string(),
    title: z.string(),
    sourceUrl: z.string().url().optional(),
  }),
  pdfUrl: z.string().url().optional(),
  durationMinutes: z.number().int().positive().default(120),
  questions: z.array(QuestionSchema),
});

export type Option = z.infer<typeof OptionSchema>;
export type SingleChoice = z.infer<typeof SingleChoiceSchema>;
export type TrueFalse = z.infer<typeof TrueFalseSchema>;
export type Programming = z.infer<typeof ProgrammingSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionType = Question["type"];
export type Paper = z.infer<typeof PaperSchema>;

const TYPE_CODE: Record<QuestionType, string> = {
  single_choice: "sc",
  true_false: "tf",
  programming: "pg",
};

export function questionId(paperId: string, q: Pick<Question, "type" | "number">) {
  return `${paperId}-${TYPE_CODE[q.type]}-${String(q.number).padStart(2, "0")}`;
}

export function paperId(examId: string, level: number, language = "cpp") {
  return `${language}-${examId}-l${level}`;
}

export const LEVEL_NAMES = ["", "一级", "二级", "三级", "四级", "五级", "六级", "七级", "八级"];
