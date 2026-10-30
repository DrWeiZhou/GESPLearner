import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

type DB = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __gespDb?: DB };

/**
 * Lazily created so the app can boot in demo mode without DATABASE_URL.
 * `prepare: false` is required for Supabase's transaction-mode pooler (port 6543),
 * which is what serverless deployments on Vercel should use.
 */
export function getDb(): DB {
  if (!globalForDb.__gespDb) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
    const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 5 });
    globalForDb.__gespDb = drizzle(client, { schema, casing: "snake_case" });
  }
  return globalForDb.__gespDb;
}

export { schema };
