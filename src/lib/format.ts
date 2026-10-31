import type { CoinReward } from "@/lib/types";

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

/**
 * How a settled reward reads to a student. A 2-point question at the default rate is
 * only worth 0.6 coins, so most gradings say what has been saved up rather than what
 * was credited — and a question that had already paid out says so, because a balance
 * that simply doesn't move is indistinguishable from a bug.
 *
 * Null only for a wrong answer on a fresh question: the red 回答错误 badge next to it
 * already explains why nothing was earned.
 */
export function formatReward(reward: CoinReward): string | null {
  if (reward.questions === 0) return "这道题之前已经结算过，不再发金币";
  if (reward.credited > 0)
    return reward.carry > 0
      ? `+${reward.credited} 金币，另攒下 ${reward.carry} 枚`
      : `+${reward.credited} 金币`;
  if (reward.coins > 0) return `攒下 ${reward.coins} 枚，共 ${reward.carry}/1 枚，满 1 枚自动入账`;
  return null;
}
