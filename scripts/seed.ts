/**
 * Imports `data/papers/*.json` into the SQLite database (idempotent upsert).
 * The app does this by itself on startup (src/db/bootstrap.ts); this is for
 * importing a subset, or as drafts.
 *
 *   bun scripts/seed.ts                  # all papers
 *   bun scripts/seed.ts cpp-2026-09-l3   # one paper
 *   bun scripts/seed.ts --draft          # import without publishing
 *
 * Also loads `data/tests/<questionId>.json` (see scripts/gen-tests.ts) as hidden
 * test cases; sample cases always come from the paper itself.
 */
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { seedPaper, type StoredCase } from "../src/lib/papers/seed";
import { PaperSchema } from "../src/lib/schema/paper";

const DATA_DIR = path.join(process.cwd(), "data");

export function loadTests(qid: string): StoredCase[] | null {
  try {
    return JSON.parse(readFileSync(path.join(DATA_DIR, "tests", `${qid}.json`), "utf8")) as StoredCase[];
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const publish = !args.includes("--draft");
  const only = args.filter((a) => a.startsWith("cpp-"));

  const dir = path.join(DATA_DIR, "papers");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const targets = files.filter((f) => only.length === 0 || only.includes(f.replace(/\.json$/, "")));

  for (const file of targets) {
    const paper = PaperSchema.parse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
    const total = seedPaper(paper, { publish, loadTests });
    console.log(`✓ ${paper.id}：${paper.questions.length} 题 / ${total} 分${publish ? "（已发布）" : "（草稿）"}`);
  }
  console.log(`完成：${targets.length} 份试卷`);
  process.exit(0);
}

if (import.meta.main) await main();
