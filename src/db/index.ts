import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

type DB = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __gespDb?: DB };

/**
 * Lazily created so the app can boot in demo mode without DATABASE_URL.
 *
 * Tuned for Supabase's transaction pooler (port 6543), which is what a serverless
 * deployment should use:
 * - `prepare: false` — transaction-mode pooling can't keep prepared statements.
 * - `idle_timeout` — the pooler (or any NAT in between) silently drops idle
 *   connections; without this, postgres.js keeps handing out dead sockets and the
 *   next query hangs until TCP gives up. Closing them early is far cheaper than
 *   that stall, even though a new connection costs ~2s from outside the region.
 * - `max_lifetime` — recycle long-lived connections for the same reason.
 * - `connect_timeout` — surface connection problems as errors instead of hanging.
 * - `max` — one connection per instance in serverless (many short-lived instances
 *   share the external pooler); a few more locally where the process is long-lived.
 */
export function getDb(): DB {
  if (!globalForDb.__gespDb) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
    const serverless = Boolean(process.env.VERCEL);
    const client = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: serverless ? 1 : 4,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      connect_timeout: 15,
    });
    globalForDb.__gespDb = drizzle(client, { schema, casing: "snake_case" });
  }
  return globalForDb.__gespDb;
}

export { schema };
