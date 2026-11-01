import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { asc, count, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { knowledgePoints, syllabi } from "@/db/schema";

/**
 * Read access to the syllabus, mirroring `lib/content`. The bundled
 * `data/syllabus/*.json` is imported into the database on first start.
 */

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

/** Every imported level, lowest first. */
export async function listSyllabi(): Promise<SyllabusView[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("syllabus");

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
  const rows = await getDb()
    .select()
    .from(knowledgePoints)
    .where(lte(knowledgePoints.level, level))
    .orderBy(asc(knowledgePoints.level), asc(knowledgePoints.sortOrder));
  return rows.map((p) => ({ id: p.id, level: p.level, block: p.block, name: p.name, summary: p.summary }));
}

/** Levels with a syllabus in the database, for the admin page. */
export async function importedSyllabusLevels(): Promise<{ level: number; points: number; updatedAt: Date }[]> {
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
