import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

type DB = ReturnType<typeof drizzle<typeof schema>>;

/** Transaction handle, for helpers that have to join a caller's transaction. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

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
 * - `max` — small, but never 1: a page renders several queries concurrently, and a
 *   single connection would both serialise them and let one stalled query deadlock
 *   the whole instance until the function times out.
 * - `statement_timeout` — a query that outlives it is cancelled server-side instead
 *   of pinning a pooler slot forever.
 *
 * Functions run in Tokyo (see vercel.json) to sit next to the database; without
 * that every one of these round trips crosses the Pacific.
 */
export function getDb(): DB {
  if (!globalForDb.__gespDb) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
    const client = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 4,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      connect_timeout: 15,
      connection: { statement_timeout: 20_000 },
    });
    globalForDb.__gespDb = drizzle(client, { schema, casing: "snake_case" });
  }
  return globalForDb.__gespDb;
}

export { schema };
