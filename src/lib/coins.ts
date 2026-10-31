import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db";
import {
  appSettings,
  attempts,
  coinTransactions,
  COIN_RATE_KEY,
  DEFAULT_COIN_RATE,
  papers,
  questionRewards,
  questions,
  users,
} from "@/db/schema";
import { HttpError } from "@/lib/auth";
import type { CoinReward } from "@/lib/types";

/**
 * Coins: a question pays out the moment it is graded, and an adult deducts coins
 * when they are cashed in for a real-world reward.
 *
 * Two rules shape the design:
 *
 * - A question pays once, the first time it is graded — so a redo, or a second pass
 *   through the wrong-answer book, earns nothing. The `question_rewards` row written
 *   at that first grading (score 0 included) is what enforces it.
 * - score × rate is rarely a whole number — a 2-point question at 0.3 is worth 0.6
 *   coins — so only whole coins reach the ledger and the remainder is carried on
 *   `users.coinCarry` until it adds up to one.
 *
 * The balance is always SUM(amount) over the ledger — never a stored counter — so
 * history stays auditable and concurrent writes can't lose an update.
 */

export type CoinTransaction = {
  id: number;
  amount: number;
  type: "reward" | "spend" | "adjust" | "earn";
  note: string | null;
  createdAt: Date;
  level: number | null;
  examId: string | null;
};

// ───────────────────────── rate ─────────────────────────

/**
 * Coins awarded per exam point. Admin-configurable; defaults to 0.3.
 *
 * Takes the connection to read on: a settlement reads the rate while holding its
 * transaction, and borrowing a second connection from the small pool to do it
 * deadlocks as soon as a few students are graded at once.
 */
export async function getCoinRate(conn: Pick<Tx, "select"> = getDb()): Promise<number> {
  const [row] = await conn.select().from(appSettings).where(eq(appSettings.key, COIN_RATE_KEY));
  const value = Number(row?.value);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_COIN_RATE;
}

export async function setCoinRate(rate: number, adminId: string) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, "兑换比例需在 0 ~ 100 之间");
  const value = round3(rate);
  await getDb()
    .insert(appSettings)
    .values({ key: COIN_RATE_KEY, value, updatedBy: adminId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: adminId, updatedAt: new Date() },
    });
  return value;
}

/**
 * Exact coins a score is worth, kept to three decimals — the same precision the
 * rate is stored at, so repeated additions can't drift away from a whole coin.
 */
export const coinsFor = (score: number, rate: number) => round3(score * rate);

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ───────────────────────── balance & history ─────────────────────────

export async function getBalance(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ balance: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)::int` })
    .from(coinTransactions)
    .where(eq(coinTransactions.userId, userId));
  return row?.balance ?? 0;
}

/** The fraction of a coin not yet credited, always < 1. */
export async function getCarry(userId: string): Promise<number> {
  const [row] = await getDb().select({ carry: users.coinCarry }).from(users).where(eq(users.id, userId));
  return row?.carry ?? 0;
}

export async function getLedger(userId: string, limit = 50): Promise<CoinTransaction[]> {
  // A row points at a paper either through its question (per-question reward) or
  // through the attempt (an exam hand-in, and legacy whole-paper redemptions).
  const paperId = sql<string | null>`coalesce(${questions.paperId}, ${attempts.paperId})`;
  return getDb()
    .select({
      id: coinTransactions.id,
      amount: coinTransactions.amount,
      type: coinTransactions.type,
      note: coinTransactions.note,
      createdAt: coinTransactions.createdAt,
      level: papers.level,
      examId: papers.examId,
    })
    .from(coinTransactions)
    .leftJoin(attempts, eq(attempts.id, coinTransactions.attemptId))
    .leftJoin(questions, eq(questions.id, coinTransactions.questionId))
    .leftJoin(papers, eq(papers.id, paperId))
    .where(eq(coinTransactions.userId, userId))
    .orderBy(desc(coinTransactions.createdAt), desc(coinTransactions.id))
    .limit(limit);
}

// ───────────────────────── rewards ─────────────────────────

export type GradedQuestion = {
  questionId: string;
  /** Points earned on the question, 0 for a wrong answer. */
  score: number;
  attemptId?: string | null;
  /** For the ledger note, e.g. "单选第 3 题". */
  label?: string;
};

/**
 * Settle freshly graded questions into coins.
 *
 * Questions that already have a `question_rewards` row are skipped, which is what
 * makes a redo — or the wrong-answer book — earn nothing. That case still comes back
 * with `questions: 0` rather than null: the student needs to be told the question
 * had already paid out, otherwise an unchanged balance just looks broken.
 *
 * Safe to call with the whole batch a hand-in produced: the carry is applied once,
 * to their total.
 */
export async function rewardQuestions(
  userId: string,
  graded: GradedQuestion[],
  tx?: Tx,
): Promise<CoinReward | null> {
  if (!graded.length) return null;
  if (!tx) return getDb().transaction((t) => rewardQuestions(userId, graded, t));

  const rate = await getCoinRate(tx);

  // Lock the wallet row: unlike the balance, the carry is a stored remainder, so two
  // concurrent settlements must not read the same value. Deductions take the same
  // lock, which serialises the whole wallet per student.
  const [owner] = await tx
    .select({ carry: users.coinCarry })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!owner) throw new HttpError(404, "用户不存在");

  const fresh = await tx
    .insert(questionRewards)
    .values(
      graded.map((g) => ({
        userId,
        questionId: g.questionId,
        attemptId: g.attemptId ?? null,
        score: g.score,
        rate,
        coins: coinsFor(g.score, rate),
      })),
    )
    .onConflictDoNothing()
    .returning({
      questionId: questionRewards.questionId,
      score: questionRewards.score,
      coins: questionRewards.coins,
    });
  const score = round3(fresh.reduce((s, r) => s + r.score, 0));
  const coins = round3(fresh.reduce((s, r) => s + r.coins, 0));
  const pending = round3(owner.carry + coins);
  const credited = Math.floor(pending);
  const carry = round3(pending - credited);

  if (fresh.length) await tx.update(users).set({ coinCarry: carry }).where(eq(users.id, userId));

  if (credited > 0) {
    const single = fresh.length === 1 ? graded.find((g) => g.questionId === fresh[0].questionId) : undefined;
    await tx.insert(coinTransactions).values({
      userId,
      amount: credited,
      type: "reward",
      questionId: single?.questionId ?? null,
      attemptId: graded[0].attemptId ?? null,
      note: single
        ? `${single.label ?? "答题"} ${score} 分 × ${rate}`
        : `${fresh.length} 道题共 ${score} 分 × ${rate}`,
    });
  }

  const [row] = await tx
    .select({ balance: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)::int` })
    .from(coinTransactions)
    .where(eq(coinTransactions.userId, userId));

  return { coins, credited, carry, balance: row?.balance ?? 0, questions: fresh.length };
}

// ───────────────────────── deductions ─────────────────────────

/** Deduct coins (cashing them in for a reward). Refuses to overdraw. */
export async function spendCoins(params: {
  userId: string;
  amount: number;
  note?: string;
  /** Set when an admin deducts from someone else's balance. */
  actorId?: string;
  type?: "spend" | "adjust";
}): Promise<{ balance: number }> {
  const { userId, amount, note, actorId, type = "spend" } = params;
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, "扣除数量需为正整数");

  const db = getDb();
  return db.transaction(async (tx) => {
    // Lock the user row so two concurrent deductions can't both pass the check.
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) throw new HttpError(404, "用户不存在");

    const [row] = await tx
      .select({ balance: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)::int` })
      .from(coinTransactions)
      .where(eq(coinTransactions.userId, userId));
    const balance = row?.balance ?? 0;
    if (balance < amount) throw new HttpError(400, `金币不足：当前仅有 ${balance} 枚`);

    await tx.insert(coinTransactions).values({
      userId,
      amount: -amount,
      type,
      note: note?.trim() || null,
      createdBy: actorId ?? userId,
    });
    return { balance: balance - amount };
  });
}

/** Admin: credit coins back / correct a mistake. */
export async function adjustCoins(params: {
  userId: string;
  amount: number;
  note?: string;
  actorId: string;
}): Promise<{ balance: number }> {
  const { userId, amount, note, actorId } = params;
  if (!Number.isInteger(amount) || amount === 0) throw new HttpError(400, "调整数量需为非零整数");
  if (amount < 0) return spendCoins({ userId, amount: -amount, note, actorId, type: "adjust" });

  await getDb()
    .insert(coinTransactions)
    .values({ userId, amount, type: "adjust", note: note?.trim() || null, createdBy: actorId });
  return { balance: await getBalance(userId) };
}
