import "server-only";
import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/db";
import { profiles } from "@/db/schema";
import { isAuthConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Accounts need both Supabase Auth (identity) and the database (records).
 * Without them the site runs in demo mode: everything works, nothing is saved.
 */
export const accountsEnabled = isAuthConfigured && isDatabaseConfigured;

export type CurrentUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: "student" | "admin";
};

/** Reads the session cookie — call only behind a <Suspense> boundary or in Route Handlers. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!accountsEnabled) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const email = typeof claims.email === "string" ? claims.email : null;
  const meta = (claims.user_metadata ?? {}) as { display_name?: string };
  const db = getDb();

  let [profile] = await db.select().from(profiles).where(eq(profiles.id, claims.sub));
  if (!profile) {
    // First visit after sign-up: create the profile lazily (no trigger on auth.users needed).
    [profile] = await db
      .insert(profiles)
      .values({ id: claims.sub, displayName: meta.display_name ?? email?.split("@")[0] ?? "同学" })
      .onConflictDoNothing()
      .returning();
    profile ??= (await db.select().from(profiles).where(eq(profiles.id, claims.sub)))[0];
  }

  return {
    id: claims.sub,
    email,
    displayName: profile?.displayName ?? email?.split("@")[0] ?? "同学",
    role: profile?.role === "admin" ? "admin" : "student",
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * For Route Handlers. In demo mode returns null so features work without persistence;
 * with accounts enabled a login is required, which also keeps judge / LLM quotas safe.
 */
export async function requireUserIfConfigured(): Promise<CurrentUser | null> {
  if (!accountsEnabled) return null;
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "请先登录");
  return user;
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  if (err && typeof err === "object" && "issues" in err) return Response.json({ error: "参数错误" }, { status: 400 });
  console.error(err);
  const message = err instanceof Error ? err.message : "服务器错误";
  return Response.json({ error: message }, { status: 500 });
}
