import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit evaluates this file in its own process, which doesn't inherit the
// runtime's .env loading — so read the env files here.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL ?? "";
if (!url) throw new Error("请在 .env.local 中配置 DATABASE_DIRECT_URL（迁移用直连/Session pooler）");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  // Supabase: use the Session pooler (5432) or direct connection for migrations,
  // not the Transaction pooler (6543) — DDL needs a session-scoped connection.
  dbCredentials: { url },
});
