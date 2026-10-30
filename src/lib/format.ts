/** "2026-09" → "2026年9月" */
export function formatExamId(examId: string) {
  const [y, m] = examId.split("-");
  return m ? `${y}年${Number(m)}月` : examId;
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const parts = [Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0"));
  return h > 0 ? [String(h).padStart(2, "0"), ...parts].join(":") : parts.join(":");
}

export const QUESTION_TYPE_LABEL = {
  single_choice: "单选题",
  true_false: "判断题",
  programming: "编程题",
} as const;
