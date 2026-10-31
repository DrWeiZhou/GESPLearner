import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { papers } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import type { Paper } from "@/lib/schema/paper";
import { downloadPdf, fetchOfficialPapers, type SourcePaper } from "./official";
import { checkPaperShape, parsePaperPdf } from "./parse";
import { embedQuestions, seedPaper, type StoredCase } from "./seed";

/**
 * 「更新题库」: compare the official paper index with the database, then import
 * papers one at a time (download → vision-model parse → shape check → upsert → embed).
 */

export type PaperStatus = "missing" | "parsed" | "published";

export type OfficialPaper = Omit<SourcePaper, "pdfFile"> & { status: PaperStatus };

export type OfficialExam = {
  examId: string;
  examTitle: string;
  sourceUrl: string;
  /**
   * Held after the newest exam in the library — what 一键更新 imports. With an
   * empty library only the latest exam counts, so the first run isn't 100 papers.
   */
  isNew: boolean;
  papers: OfficialPaper[];
};

export type UpdateCheck = {
  checkedAt: string;
  exams: OfficialExam[];
  /** Levels with at least one published paper — the default selection for a new exam. */
  libraryLevels: number[];
};

export async function checkForUpdates(): Promise<UpdateCheck> {
  const official = await fetchOfficialPapers().catch((err) => {
    console.error(err);
    throw new HttpError(502, "无法访问 GESP 官网真题页面，请稍后再试");
  });
  const rows = await getDb()
    .select({ id: papers.id, examId: papers.examId, level: papers.level, status: papers.status })
    .from(papers);
  // "crawled" rows (PDF known, never imported) count as missing.
  const imported = rows.filter((r) => r.status === "published" || r.status === "parsed");
  const statusOf = new Map(imported.map((r) => [r.id, r.status as Exclude<PaperStatus, "missing">]));
  const newestImported = imported.reduce<string | null>((m, r) => (m && m > r.examId ? m : r.examId), null);
  const isNew = (examId: string) => (newestImported ? examId > newestImported : examId === official[0]?.examId);

  const exams = new Map<string, OfficialExam>();
  for (const { pdfFile, ...p } of official) {
    void pdfFile;
    const exam = exams.get(p.examId) ?? {
      examId: p.examId,
      examTitle: p.examTitle,
      sourceUrl: p.sourceUrl,
      isNew: isNew(p.examId),
      papers: [],
    };
    exam.papers.push({ ...p, status: statusOf.get(p.id) ?? "missing" });
    exams.set(p.examId, exam);
  }

  const libraryLevels = [...new Set(rows.filter((r) => r.status === "published").map((r) => r.level))].sort(
    (a, b) => a - b,
  );
  return { checkedAt: new Date().toISOString(), exams: [...exams.values()], libraryLevels };
}

export type ImportResult = {
  id: string;
  status: "published" | "parsed";
  questions: number;
  totalScore: number;
  /** Why the paper was kept as a draft instead of being published. */
  warnings: string[];
  /** Embedding is best-effort; a failure here doesn't undo the import. */
  embedError: string | null;
};

/**
 * Parses and upserts one paper. Requested publication is downgraded to a draft
 * when the shape check fails, so a botched transcription never reaches students.
 */
export async function importPaper(
  source: Omit<SourcePaper, "pdfFile">,
  {
    publish,
    pdf,
    paper: parsed,
    loadTests,
    onParsed,
  }: {
    publish: boolean;
    /** Already-downloaded PDF (the CLI keeps a copy in data/pdf/). */
    pdf?: Uint8Array;
    /** Already-parsed paper (an existing data/papers/<id>.json): skips download and parse. */
    paper?: Paper;
    loadTests?: (qid: string) => Promise<StoredCase[] | null>;
    /** Lets the CLI write data/papers/<id>.json before the database step. */
    onParsed?: (paper: Paper) => Promise<void>;
  },
): Promise<ImportResult> {
  let paper = parsed;
  if (!paper) {
    paper = await parsePaperPdf(source, pdf ?? (await downloadPdf(source.pdfUrl)));
    await onParsed?.(paper);
  }

  const warnings = checkPaperShape(paper);
  const status = publish && warnings.length === 0 ? "published" : "parsed";
  const totalScore = await seedPaper(paper, { publish: status === "published", loadTests });

  let embedError: string | null = null;
  try {
    await embedQuestions({ paperId: paper.id });
  } catch (err) {
    embedError = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
  }

  return { id: paper.id, status, questions: paper.questions.length, totalScore, warnings, embedError };
}

/** Publishes a draft after the admin has looked it over. */
export async function publishPaper(id: string) {
  const [row] = await getDb()
    .update(papers)
    .set({ status: "published", updatedAt: new Date() })
    .where(eq(papers.id, id))
    .returning({ id: papers.id });
  return Boolean(row);
}
