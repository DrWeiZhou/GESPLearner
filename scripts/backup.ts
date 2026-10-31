/**
 * Dumps the database to `data/backups/gesp-<timestamp>.dump` (pg_dump custom format,
 * compressed). Covers the app's tables (`public`), the migration log (`drizzle`) and
 * the pgvector extension; Supabase's own schemas (auth, storage, vault…) are left out.
 *
 *   bun scripts/backup.ts             # new dump, keep the newest 30
 *   bun scripts/backup.ts --keep 10
 *
 * Restore into an empty database (e.g. a fresh Supabase project):
 *   pg_restore --no-owner --no-privileges -d "<DATABASE_DIRECT_URL>" data/backups/gesp-….dump
 * The one error it reports, `schema "public" already exists`, is expected and harmless.
 *
 * Needs `pg_dump` whose major version is ≥ the server's (Supabase runs 17):
 * `brew install postgresql@17`.
 */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const BACKUP_DIR = path.join(process.cwd(), "data", "backups");

// The transaction pooler (6543) can't serve pg_dump; the direct / session URL (5432) can.
const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("未配置 DATABASE_DIRECT_URL");
  process.exit(1);
}

const keepArg = process.argv.indexOf("--keep");
const keep = keepArg >= 0 ? Number(process.argv[keepArg + 1]) : 30;

await mkdir(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const file = path.join(BACKUP_DIR, `gesp-${stamp}.dump`);

const started = Date.now();
const proc = Bun.spawnSync(
  // --schema alone leaves out extensions; questions.embedding needs pgvector to restore.
  ["pg_dump", "--format=custom", "--schema=public", "--schema=drizzle", "--extension=vector", "--no-owner", "--no-privileges", "--file", file, url],
  { stdout: "inherit", stderr: "pipe" },
);
if (proc.exitCode !== 0) {
  await rm(file, { force: true });
  console.error(`备份失败：${proc.stderr.toString().trim()}`);
  process.exit(1);
}
const size = (await stat(file)).size;
console.log(`✓ ${path.relative(process.cwd(), file)}（${(size / 1024).toFixed(0)} KB，${((Date.now() - started) / 1000).toFixed(1)} 秒）`);

// Timestamped names sort chronologically.
const dumps = (await readdir(BACKUP_DIR)).filter((f) => /^gesp-.*\.dump$/.test(f)).sort();
for (const old of dumps.slice(0, Math.max(0, dumps.length - keep))) {
  await rm(path.join(BACKUP_DIR, old));
  console.log(`删除旧备份 ${old}`);
}
