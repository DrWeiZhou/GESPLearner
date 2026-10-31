import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Canonical shape of one level of the GESP syllabus (《CCF 编程能力等级认证标准》).
 * Produced by `scripts/syllabus.ts`, stored in `data/syllabus/l<N>.json`, seeded
 * into Postgres alongside the papers.
 *
 * The official PDF describes a level as 知识块（knowledge blocks）each holding
 * several 知识点（knowledge points）. A knowledge point is the unit the wrong-answer
 * book groups by, so it has to be specific enough to judge a question against.
 */

export const KnowledgePointSchema = z.object({
  /** 知识块, e.g. "基本数据类型" */
  block: z.string().min(1),
  /** 知识点, e.g. "整型与溢出" */
  name: z.string().min(1),
  /** One sentence spelling out what the point covers, used when classifying questions. */
  summary: z.string().default(""),
});

export const SyllabusSchema = z.object({
  level: z.number().int().min(1).max(8),
  language: z.literal("cpp"),
  /** 考核目标, as printed in the syllabus. */
  objective: z.string().default(""),
  pdfUrl: z.string().url().optional(),
  sourceUrl: z.string().url().optional(),
  /** 1-based page range of this level inside the shared PDF, for troubleshooting. */
  pages: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  points: z.array(KnowledgePointSchema).min(1),
});

export type KnowledgePoint = z.infer<typeof KnowledgePointSchema>;
export type Syllabus = z.infer<typeof SyllabusSchema>;

/**
 * Stable id for a knowledge point: level plus a hash of its name.
 *
 * Deriving it from the name rather than the position means re-parsing the syllabus
 * keeps every id that still describes the same thing, so the question
 * classifications attached to it survive. A renamed point becomes a new id, its
 * old row is dropped, and the questions under it are classified again.
 */
export function knowledgePointId(level: number, name: string) {
  const digest = createHash("sha256").update(`${level}:${name}`).digest("hex").slice(0, 8);
  return `kp-l${level}-${digest}`;
}
