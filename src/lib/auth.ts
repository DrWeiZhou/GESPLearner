import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/db";
import { sessions, users } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * Username/password accounts with server-side sessions.
 *
 * GESP students are children who often have no mailbox, so the app keeps its own
 * accounts instead of using Supabase Auth; Supabase is just the Postgres host.
 */

export const accountsEnabled = isDatabaseConfigured;

export const SESSION_COOKIE = "gesp_session";
const SESSION_DAYS = 30;
/** Lock an account briefly after repeated wrong passwords. */
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  role: "student" | "admin";
};

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ───────────────────────── registration & login ─────────────────────────

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function registerUser(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<CurrentUser> {
  const db = getDb();
  const username = input.username.trim();
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "用户名需为 3~20 位字母、数字、下划线或连字符");
  if (input.password.length < 6) throw new HttpError(400, "密码至少 6 位");

  const passwordHash = await hashPassword(input.password);
  // The very first account administers the system (sets the coin rate, adjusts coins).
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const role = count === 0 ? "admin" : "student";

  try {
    const [row] = await db
      .insert(users)
      .values({ username, passwordHash, displayName: input.displayName?.trim() || username, role })
      .returning();
    return { id: row.id, username: row.username, displayName: row.displayName ?? row.username, role: row.role };
  } catch (err) {
    if (isUniqueViolation(err, "users_username_key")) throw new HttpError(409, "该用户名已被注册");
    throw err;
  }
}

export async function authenticate(username: string, password: string): Promise<CurrentUser> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username.trim()})`);

  // Same message either way, so the form can't be used to discover usernames.
  const invalid = new HttpError(401, "用户名或密码错误");
  if (!row) {
    // Spend comparable time so a missing user isn't obvious from the response time.
    await verifyPassword(password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    throw invalid;
  }
  if (row.lockedUntil && row.lockedUntil > new Date())
    throw new HttpError(429, `密码错误次数过多，请在 ${LOCK_MINUTES} 分钟后再试`);

  if (!(await verifyPassword(password, row.passwordHash))) {
    const failed = row.failedAttempts + 1;
    await db
      .update(users)
      .set({
        failedAttempts: failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, row.id));
    throw invalid;
  }

  await db
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, row.id));
  return { id: row.id, username: row.username, displayName: row.displayName ?? row.username, role: row.role };
}

// ───────────────────────── sessions ─────────────────────────

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await getDb().insert(sessions).values({ userId, tokenHash: tokenHash(token), expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token && isDatabaseConfigured) {
    await getDb().delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Reads the session cookie — only valid behind <Suspense>, or in Route Handlers / Actions. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!accountsEnabled) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await getDb()
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // Compare against the database clock: this runs while the static shell is being
    // prerendered, where Cache Components rejects an unstable `new Date()`.
    .where(and(eq(sessions.tokenHash, tokenHash(token)), sql`${sessions.expiresAt} > now()`));

  return row ? { ...row, displayName: row.displayName ?? row.username } : null;
}

// ───────────────────────── guards ─────────────────────────

/**
 * For Route Handlers. Without a database the app runs in demo mode (nothing is
 * saved) so features stay usable; with one configured, a login is required.
 */
export async function requireUserIfConfigured(): Promise<CurrentUser | null> {
  if (!accountsEnabled) return null;
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "请先登录");
  return user;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "请先登录");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new HttpError(403, "需要管理员权限");
  return user;
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  if (err && typeof err === "object" && "issues" in err) return Response.json({ error: "参数错误" }, { status: 400 });
  // Anything else is unexpected: log it server-side, but never hand the client the
  // raw message — a Drizzle error carries the failed SQL and its parameters.
  console.error(err);
  return Response.json({ error: "服务器错误，请稍后再试" }, { status: 500 });
}
