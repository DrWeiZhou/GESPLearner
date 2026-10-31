import "server-only";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { seedPaper, type StoredCase } from "@/lib/papers/seed";
import { PaperSchema } from "@/lib/schema/paper";
import { SyllabusSchema } from "@/lib/schema/syllabus";
import { seedSyllabus } from "@/lib/syllabus/seed";
import { appSettings, CONTENT_VERSION_KEY } from "./schema";
import { dataDir, type DB } from "./index";

/**
 * The question bank ships with the program: `data/papers/*.json` (106 official
 * papers) and `data/syllabus/l<N>.json`. They are imported into the user's
 * database on first start, and again whenever an update brings different files —
 * the stored version is a hash of their contents, so an unchanged bank costs one
 * read at startup.
 *
 * Imports are idempotent upserts, and answer records hang off question ids that
 * don't change, so re-importing never touches anyone's history. Papers an admin
 * added through「更新题库」aren't in the bundle and are left alone.
 */

const jsonFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];

function loadTests(qid: string): StoredCase[] | null {
  const file = path.join(dataDir(), "tests", `${qid}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as StoredCase[];
  } catch {
    return null;
  }
}

export function bootstrapContent(db: DB, { force = false, log = console.log } = {}) {
  const papersDir = path.join(dataDir(), "papers");
  const syllabusDir = path.join(dataDir(), "syllabus");
  const testsDir = path.join(dataDir(), "tests");

  const files = [
    ...jsonFiles(papersDir).map((f) => path.join(papersDir, f)),
    ...jsonFiles(syllabusDir).map((f) => path.join(syllabusDir, f)),
    ...jsonFiles(testsDir).map((f) => path.join(testsDir, f)),
  ];
  if (files.length === 0) return { papers: 0, syllabi: 0, skipped: true };

  const hash = createHash("sha256");
  const contents = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    contents.set(file, text);
    hash.update(path.basename(file)).update("\0").update(text).update("\0");
  }
  const version = hash.digest("hex").slice(0, 16);

  const current = db.select().from(appSettings).where(eq(appSettings.key, CONTENT_VERSION_KEY)).get();
  if (!force && current?.value === version) return { papers: 0, syllabi: 0, skipped: true };

  const started = Date.now();
  let papers = 0;
  for (const f of jsonFiles(papersDir)) {
    const file = path.join(papersDir, f);
    try {
      seedPaper(PaperSchema.parse(JSON.parse(contents.get(file)!)), { publish: true, loadTests });
      papers++;
    } catch (err) {
      console.error(`导入试卷 ${f} 失败：`, err);
    }
  }
  let syllabi = 0;
  for (const f of jsonFiles(syllabusDir)) {
    const file = path.join(syllabusDir, f);
    try {
      seedSyllabus(SyllabusSchema.parse(JSON.parse(contents.get(file)!)));
      syllabi++;
    } catch (err) {
      console.error(`导入大纲 ${f} 失败：`, err);
    }
  }

  db.insert(appSettings)
    .values({ key: CONTENT_VERSION_KEY, value: version })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: version, updatedAt: new Date() } })
    .run();
  log(`内置题库已导入：${papers} 份试卷、${syllabi} 个级别的大纲（${Date.now() - started} ms）`);
  return { papers, syllabi, skipped: false };
}
