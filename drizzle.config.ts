import { defineConfig } from "drizzle-kit";

// Migrations are generated here and applied by the app itself on startup
// (src/db/index.ts), so drizzle-kit only needs a scratch file for `migrate`/`studio`.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  casing: "snake_case",
  dbCredentials: { url: process.env.GESP_DB_PATH ?? "data/gesp.db" },
});
