import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import { asc, count, inArray, lte } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/db";
import { knowledgePoints, syllabi } from "@/db/schema";
import { knowledgePointId, SyllabusSchema, type Syllabus } from "@/lib/schema/syllabus";

/**
 * Read access to the syllabus, mirroring `lib/content`: Postgres when DATABASE_URL
 * is set, otherwise `data/syllabus/*.json` (demo mode).
 */

const DATA_DIR = path.join(process.cwd(), "data", "syllabus");

export type KnowledgePointView = {
  id: string;
  level: number;
  block: string;
  name: string;
  summary: string;
};

export type SyllabusView = {
  level: number;
  objective: string;
  pdfUrl: string | null;
  sourceUrl: string | null;
  points: KnowledgePointView[];
};

async function loadLocalSyllabi(): Promise<Syllabus[]> {
  let files: string[] = [];
  try {
    files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return Promise.all(
    files.map(async (f) => SyllabusSchema.parse(JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8")))),
  );
}

const toView = (s: Syllabus): SyllabusView => ({
  level: s.level,
  objective: s.objective,
  pdfUrl: s.pdfUrl ?? null,
  sourceUrl: s.sourceUrl ?? null,
  points: s.points.map((p) => ({
    id: knowledgePointId(s.level, p.name),
    level: s.level,
    block: p.block,
    name: p.name,
    summary: p.summary,
  })),
});

/** Every imported level, lowest first. */
export async function listSyllabi(): Promise<SyllabusView[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("syllabus");

  if (!isDatabaseConfigured) return (await loadLocalSyllabi()).map(toView).sort((a, b) => a.level - b.level);

  const db = getDb();
  const heads = await db.select().from(syllabi).orderBy(asc(syllabi.level));
  if (heads.length === 0) return [];
  const points = await db
    .select()
    .from(knowledgePoints)
    .where(inArray(knowledgePoints.level, heads.map((h) => h.level)))
    .orderBy(asc(knowledgePoints.level), asc(knowledgePoints.sortOrder));

  return heads.map((h) => ({
    level: h.level,
    objective: h.objective,
    pdfUrl: h.pdfUrl,
    sourceUrl: h.sourceUrl,
    points: points
      .filter((p) => p.level === h.level)
      .map((p) => ({ id: p.id, level: p.level, block: p.block, name: p.name, summary: p.summary })),
  }));
}

export async function getSyllabus(level: number): Promise<SyllabusView | null> {
  return (await listSyllabi()).find((s) => s.level === level) ?? null;
}

/**
 * Candidates for classifying a question: the level's own points plus every lower
 * level's. GESP is cumulative — a 五级 question routinely turns on 三级 material.
 */
export async function candidatePoints(level: number): Promise<KnowledgePointView[]> {
  if (!isDatabaseConfigured) {
    return (await listSyllabi()).filter((s) => s.level <= level).flatMap((s) => s.points);
  }
  const rows = await getDb()
    .select()
    .from(knowledgePoints)
    .where(lte(knowledgePoints.level, level))
    .orderBy(asc(knowledgePoints.level), asc(knowledgePoints.sortOrder));
  return rows.map((p) => ({ id: p.id, level: p.level, block: p.block, name: p.name, summary: p.summary }));
}

/** Levels with a syllabus in the database, for the admin page. */
export async function importedSyllabusLevels(): Promise<{ level: number; points: number; updatedAt: Date }[]> {
  if (!isDatabaseConfigured) return [];
  const db = getDb();
  const heads = await db.select().from(syllabi).orderBy(asc(syllabi.level));
  if (heads.length === 0) return [];
  const counts = await db
    .select({ level: knowledgePoints.level, n: count() })
    .from(knowledgePoints)
    .groupBy(knowledgePoints.level);
  return heads.map((h) => ({
    level: h.level,
    points: Number(counts.find((c) => c.level === h.level)?.n ?? 0),
    updatedAt: h.updatedAt,
  }));
}
