import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { coinTransactions, sessions, users } from "@/db/schema";
import { NOW_MS } from "@/lib/auth";

/** Admin view of an account. Never carries the password hash. */
export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: "student" | "admin";
  createdAt: Date;
  lastLoginAt: Date | null;
  /** Set while the account is locked out after repeated wrong passwords. */
  lockedUntil: Date | null;
  coins: number;
  activeSessions: number;
};

export async function listUsers(): Promise<ManagedUser[]> {
  const db = getDb();

  // Aggregated separately rather than as correlated subqueries: inside a `sql`
  // template Drizzle renders `users.id` unqualified, which SQL then resolves
  // against the subquery's own table.
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  const balances = await db
    .select({ userId: coinTransactions.userId, total: sql<number>`coalesce(sum(${coinTransactions.amount}), 0)` })
    .from(coinTransactions)
    .groupBy(coinTransactions.userId);

  const active = await db
    .select({ userId: sessions.userId, n: sql<number>`count(*)` })
    .from(sessions)
    .where(sql`${sessions.expiresAt} > ${NOW_MS}`)
    .groupBy(sessions.userId);

  // Fractional balances, so round the REAL sum (see lib/coins).
  const coinsBy = new Map(balances.map((b) => [b.userId, Math.round(Number(b.total) * 1000) / 1000]));
  const sessionsBy = new Map(active.map((a) => [a.userId, Number(a.n)]));

  return rows.map((r) => ({
    ...r,
    displayName: r.displayName ?? r.username,
    coins: coinsBy.get(r.id) ?? 0,
    activeSessions: sessionsBy.get(r.id) ?? 0,
  }));
}

/** Signs a user out everywhere without touching their password. */
export async function revokeSessions(userId: string) {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}
