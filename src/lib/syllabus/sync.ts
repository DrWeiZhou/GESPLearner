import "server-only";
import { downloadPdf } from "@/lib/papers/official";
import type { Syllabus } from "@/lib/schema/syllabus";
import { importedSyllabusLevels } from "./content";
import { fetchSyllabusSource, type SyllabusSource } from "./official";
import { parseSyllabusLevel, readSyllabusPdf, type SyllabusPdf } from "./parse";
import { seedSyllabus } from "./seed";

/**
 * 「更新考试大纲」: fetch the official syllabus PDF once, then parse and import one
 * level at a time — each level is its own vision-model call, so each gets its own
 * function time budget (see api/admin/syllabus/import).
 */

export type SyllabusStatus = {
  level: number;
  /** Pages this level occupies in the official PDF. */
  pages: [number, number];
  /** Knowledge points already imported, 0 when the level has never been parsed. */
  points: number;
  updatedAt: string | null;
};

export type SyllabusCheck = {
  checkedAt: string;
  source: SyllabusSource;
  levels: SyllabusStatus[];
};

/** What the official PDF offers, against what the library already has. */
export async function checkSyllabus(): Promise<SyllabusCheck> {
  const source = await fetchSyllabusSource();
  const { sections } = await readSyllabusPdf(await downloadPdf(source.pdfUrl));
  const imported = await importedSyllabusLevels();

  return {
    checkedAt: new Date().toISOString(),
    source,
    levels: sections.map((s) => {
      const row = imported.find((i) => i.level === s.level);
      return {
        level: s.level,
        pages: [s.from, s.to] as [number, number],
        points: row?.points ?? 0,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    }),
  };
}

export type SyllabusImportResult = { level: number; points: number; objective: string };

/** Parses one level and upserts it. `pdf`/`parsed` let the CLI reuse work. */
export async function importSyllabusLevel(
  level: number,
  {
    source,
    pdf,
    syllabus,
    onParsed,
  }: {
    source?: SyllabusSource;
    /** Already-read PDF, so importing all eight levels downloads it once. */
    pdf?: SyllabusPdf;
    /** Already-parsed level (an existing data/syllabus/l<N>.json): skips the model call. */
    syllabus?: Syllabus;
    onParsed?: (syllabus: Syllabus) => Promise<void>;
  } = {},
): Promise<SyllabusImportResult> {
  let parsed = syllabus;
  if (!parsed) {
    const src = source ?? (await fetchSyllabusSource());
    const doc = pdf ?? (await readSyllabusPdf(await downloadPdf(src.pdfUrl)));
    parsed = await parseSyllabusLevel(level, doc, src);
    await onParsed?.(parsed);
  }
  const points = await seedSyllabus(parsed);
  return { level, points, objective: parsed.objective };
}
