import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { knowledgePoints, syllabi } from "@/db/schema";
import { knowledgePointId, type Syllabus } from "@/lib/schema/syllabus";

/**
 * Idempotent upsert of one level's syllabus.
 *
 * Points that no longer appear are deleted, which cascades to the question
 * classifications under them (`question_knowledge`) — those questions are then
 * classified again against the new list the next time they're missed.
 */
export function seedSyllabus(syllabus: Syllabus, db: DB = getDb()) {
  const rows = syllabus.points.map((p, i) => ({
    id: knowledgePointId(syllabus.level, p.name),
    level: syllabus.level,
    block: p.block,
    name: p.name,
    summary: p.summary,
    sortOrder: i,
  }));

  // One synchronous transaction, like seedPaper.
  db.transaction((tx) => {
    const head = {
      level: syllabus.level,
      language: syllabus.language,
      objective: syllabus.objective,
      pdfUrl: syllabus.pdfUrl ?? null,
      sourceUrl: syllabus.sourceUrl ?? null,
      pages: syllabus.pages ?? null,
      updatedAt: new Date(),
    };
    tx.insert(syllabi).values(head).onConflictDoUpdate({ target: syllabi.level, set: head }).run();

    // Points the new parse dropped (a level always has at least one, see the schema).
    // Deleting them cascades to question_knowledge.
    tx.delete(knowledgePoints)
      .where(
        and(eq(knowledgePoints.level, syllabus.level), notInArray(knowledgePoints.id, rows.map((r) => r.id))),
      )
      .run();

    for (const row of rows) {
      tx.insert(knowledgePoints).values(row).onConflictDoUpdate({ target: knowledgePoints.id, set: row }).run();
    }
  });

  return rows.length;
}
