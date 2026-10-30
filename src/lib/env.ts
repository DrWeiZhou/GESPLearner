/** Public (browser-safe) env. Server-only flags live in `@/lib/auth`. */

/** Supabase is used purely as the Postgres host; accounts are the app's own. */
export const supabaseProjectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
