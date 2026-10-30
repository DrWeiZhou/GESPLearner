import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appSettings,
  attempts,
  coinTransactions,
  COIN_RATE_KEY,
  DEFAULT_COIN_RATE,
  papers,
  users,
} from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db-errors";

/**
 * Coins: students convert an exam score into coins once per finished attempt, and
 * an adult deducts them when the coins are cashed in for a real-world reward.
 *
 * The balance is always SUM(amount) over the ledger — never a stored counter — so
 * history stays auditable and concurrent writes can't lose an update.
 */

export type CoinTransaction = {
  id: number;
  amount: number;
  type: "earn" | "spend" | "adjust";
  note: string | null;
  createdAt: Date;
  attemptId: string | null;
  paperId: string | null;
  level: number | null;
  examId: string | null;
};

export type RedeemableAttempt = {
  attemptId: string;
  paperId: string;
  examId: string;
  level: number;
  score: number;
  maxScore: number;
  submittedAt: Date;
  coins: number;
};

// ───────────────────────── rate ─────────────────────────

/** Coins awarded per exam point. Admin-configurable; defaults to 0.3. */
export async function getCoinRate(): Promise<number> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, COIN_RATE_KEY));
  const value = Number(row?.value);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_COIN_RATE;
}

export async function setCoinRate(rate: number, adminId: string) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, "兑换比例需在 0 ~ 100 之间");
  const value = Math.round(rate * 1000) / 1000;
  await getDb()
    .insert(appSettings)
    .values({ key: COIN_RATE_KEY, value, updatedBy: adminId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: adminId, updatedAt: new Date() },
    });
  return value;
}

/** Whole coins only — a 7-point score at 0.3 is 2 coins, not 2.1. */
export const coinsFor = (score: number, rate: number) => Math.floor(score * rate);

// ───────────────────────── balance & history ─────────────────────────

export async function getBalance(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ balance: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)::int` })
    .from(coinTransactions)
    .where(eq(coinTransactions.userId, userId));
  return row?.balance ?? 0;
}

export async function getLedger(userId: string, limit = 50): Promise<CoinTransaction[]> {
  return getDb()
    .select({
      id: coinTransactions.id,
      amount: coinTransactions.amount,
      type: coinTransactions.type,
      note: coinTransactions.note,
      createdAt: coinTransactions.createdAt,
      attemptId: coinTransactions.attemptId,
      paperId: attempts.paperId,
      level: papers.level,
      examId: papers.examId,
    })
    .from(coinTransactions)
    .leftJoin(attempts, eq(attempts.id, coinTransactions.attemptId))
    .leftJoin(papers, eq(papers.id, attempts.paperId))
    .where(eq(coinTransactions.userId, userId))
    .orderBy(desc(coinTransactions.createdAt), desc(coinTransactions.id))
    .limit(limit);
}

/** Finished attempts that have not been converted into coins yet. */
export async function getRedeemableAttempts(userId: string): Promise<RedeemableAttempt[]> {
  const rate = await getCoinRate();
  const rows = await getDb()
    .select({
      attemptId: attempts.id,
      paperId: attempts.paperId,
      examId: papers.examId,
      level: papers.level,
      score: attempts.score,
      maxScore: attempts.maxScore,
      submittedAt: attempts.submittedAt,
    })
    .from(attempts)
    .innerJoin(papers, eq(papers.id, attempts.paperId))
    .where(
      and(
        eq(attempts.userId, userId),
        isNotNull(attempts.submittedAt),
        sql`not exists (
          select 1 from ${coinTransactions} ct
          where ct.attempt_id = ${attempts.id} and ct.type = 'earn'
        )`,
      ),
    )
    .orderBy(desc(attempts.submittedAt));

  return rows.map((r) => ({
    attemptId: r.attemptId,
    paperId: r.paperId,
    examId: r.examId,
    level: r.level,
    score: r.score ?? 0,
    maxScore: r.maxScore ?? 0,
    submittedAt: r.submittedAt!,
    coins: coinsFor(r.score ?? 0, rate),
  }));
}

// ───────────────────────── mutations ─────────────────────────

export type RedeemResult = { coins: number; score: number; rate: number; balance: number };

/** Convert one finished attempt into coins. The unique index makes this idempotent-safe. */
export async function redeemAttempt(userId: string, attemptId: string): Promise<RedeemResult> {
  const db = getDb();
  const [attempt] = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)));

  if (!attempt) throw new HttpError(404, "考试记录不存在");
  if (!attempt.submittedAt) throw new HttpError(400, "该试卷还没有交卷");

  const rate = await getCoinRate();
  const score = attempt.score ?? 0;
  const coins = coinsFor(score, rate);
  if (coins <= 0) throw new HttpError(400, "本次得分太低，还兑换不到 1 枚金币");

  try {
    await db.insert(coinTransactions).values({
      userId,
      amount: coins,
      type: "earn",
      attemptId,
      note: `试卷得分 ${score} × ${rate}`,
    });
  } catch (err) {
    // The partial unique index on (attempt_id) where type='earn' is the real guard
    // against double redemption, including two concurrent requests.
    if (isUniqueViolation(err, "coin_tx_one_earn_per_attempt"))
      throw new HttpError(409, "这份试卷已经兑换过金币了");
    throw err;
  }

  return { coins, score, rate, balance: await getBalance(userId) };
}

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
