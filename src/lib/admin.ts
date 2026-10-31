import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { coinTransactions, sessions, users } from "@/db/schema";

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
  const rows = await getDb()
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
      coins: sql<number>`(
        select coalesce(sum(ct.amount), 0)::int
        from ${coinTransactions} ct where ct.user_id = ${users.id}
      )`,
      activeSessions: sql<number>`(
        select count(*)::int from ${sessions} s
        where s.user_id = ${users.id} and s.expires_at > now()
      )`,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  return rows.map((r) => ({
    ...r,
    displayName: r.displayName ?? r.username,
    coins: Number(r.coins),
    activeSessions: Number(r.activeSessions),
  }));
}

/** Signs a user out everywhere without touching their password. */
export async function revokeSessions(userId: string) {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}
