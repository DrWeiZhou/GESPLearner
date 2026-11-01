/**
 * Creates (or brings up to date) a SQLite database with the bundled question bank:
 * runs the migrations and imports data/papers + data/syllabus.
 *
 *   bun --conditions react-server scripts/desktop/prepare-db.ts [file.db] [--force]
 *
 * The desktop build points `next build` at such a file, so pages prerendered at
 * build time see the same papers the app imports on first start.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { count } from "drizzle-orm";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (file) process.env.GESP_DB_PATH = path.resolve(file);
if (args.includes("--fresh") && process.env.GESP_DB_PATH) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(process.env.GESP_DB_PATH + suffix, { force: true });
}

async function main() {
  const { getDb, closeDb, dbPath } = await import("../../src/db");
  const { bootstrapContent } = await import("../../src/db/bootstrap");
  const { knowledgePoints, papers, questions } = await import("../../src/db/schema");

  const db = getDb();
  if (args.includes("--force")) bootstrapContent(db, { force: true });

  const [p] = db.select({ n: count() }).from(papers).all();
  const [q] = db.select({ n: count() }).from(questions).all();
  const [k] = db.select({ n: count() }).from(knowledgePoints).all();
  console.log(`${dbPath()}：${p.n} 份试卷、${q.n} 道题、${k.n} 个知识点`);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
