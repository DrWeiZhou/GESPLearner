import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { EMBEDDING_DIMENSIONS, exams, papers, questionKeys, questions, testCases } from "@/db/schema";
import { getEmbeddings } from "@/lib/ai/model";
import { questionId, type Paper } from "@/lib/schema/paper";

export type StoredCase = { idx: number; input: string; expectedOutput: string; isSample: boolean };

/**
 * Idempotent upsert of one paper with its questions, answer keys and test cases.
 * Hidden test cases come from `loadTests` (see scripts/gen-tests.ts); without
 * them a programming question is judged on its samples only.
 */
export async function seedPaper(
  paper: Paper,
  { publish, loadTests }: { publish: boolean; loadTests?: (qid: string) => Promise<StoredCase[] | null> },
) {
  const db = getDb();
  const totalScore = paper.questions.reduce((s, q) => s + q.score, 0);

  await db.transaction(async (tx) => {
    await tx
      .insert(exams)
      .values({ id: paper.exam.id, title: paper.exam.title, sourceUrl: paper.exam.sourceUrl })
      .onConflictDoUpdate({
        target: exams.id,
        set: { title: paper.exam.title, sourceUrl: paper.exam.sourceUrl },
      });

    const paperValues = {
      id: paper.id,
      examId: paper.exam.id,
      language: paper.language,
      level: paper.level,
      pdfUrl: paper.pdfUrl,
      durationMinutes: paper.durationMinutes,
      status: publish ? ("published" as const) : ("parsed" as const),
      totalScore,
      updatedAt: new Date(),
    };
    await tx.insert(papers).values(paperValues).onConflictDoUpdate({ target: papers.id, set: paperValues });

    // Drop questions that disappeared from the JSON (re-parses can change numbering).
    const ids = paper.questions.map((q) => questionId(paper.id, q));
    const existing = await tx.select({ id: questions.id }).from(questions).where(eq(questions.paperId, paper.id));
    const stale = existing.filter((r) => !ids.includes(r.id)).map((r) => r.id);
    if (stale.length) await tx.delete(questions).where(inArray(questions.id, stale));

    for (const [i, q] of paper.questions.entries()) {
      const id = questionId(paper.id, q);
      const row = {
        id,
        paperId: paper.id,
        type: q.type,
        number: q.number,
        score: q.score,
        stem: q.type === "programming" ? q.description : q.stem,
        options: q.type === "single_choice" ? q.options : null,
        title: q.type === "programming" ? q.title : null,
        timeLimitMs: q.type === "programming" ? q.timeLimitMs : null,
        memoryLimitMb: q.type === "programming" ? q.memoryLimitMb : null,
        inputFormat: q.type === "programming" ? q.inputFormat : null,
        outputFormat: q.type === "programming" ? q.outputFormat : null,
        samples: q.type === "programming" ? q.samples : null,
        dataRange: q.type === "programming" ? (q.dataRange ?? null) : null,
        sortOrder: i,
      };
      // Leave the embedding untouched so re-seeding doesn't force a re-embed.
      await tx.insert(questions).values(row).onConflictDoUpdate({ target: questions.id, set: row });

      const key = {
        questionId: id,
        answer: q.type === "programming" ? null : q.answer,
        explanation: q.type === "programming" ? null : (q.explanation ?? null),
        referenceSolution: q.type === "programming" ? (q.referenceSolution ?? null) : null,
      };
      await tx.insert(questionKeys).values(key).onConflictDoUpdate({ target: questionKeys.questionId, set: key });

      if (q.type !== "programming") continue;

      const generated = (await loadTests?.(id)) ?? null;
      const cases: StoredCase[] =
        generated ??
        q.samples.map((s, idx) => ({ idx, input: s.input, expectedOutput: s.output, isSample: true }));
      await tx.delete(testCases).where(eq(testCases.questionId, id));
      if (cases.length)
        await tx.insert(testCases).values(cases.map((c) => ({ ...c, questionId: id })));
    }
  });

  return totalScore;
}

/** Strip Markdown/LaTeX noise so the vector reflects the actual wording. */
export function embeddingText(q: typeof questions.$inferSelect) {
  const parts = [q.title, q.stem, ...(q.options ?? []).map((o) => o.content), q.inputFormat, q.outputFormat, q.dataRange];
  return parts
    .filter(Boolean)
    .join("\n")
    .replace(/```[\s\S]*?```/g, " [代码] ")
    .replace(/[#*`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

/**
 * Embeds questions that have no vector yet (all of them with `force`), optionally
 * limited to one paper. Returns how many were embedded.
 */
export async function embedQuestions(
  { paperId, force = false, log = () => {} }: { paperId?: string; force?: boolean; log?: (msg: string) => void } = {},
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(questions)
    .where(and(paperId ? eq(questions.paperId, paperId) : undefined, force ? undefined : isNull(questions.embedding)));
  if (rows.length === 0) return 0;

  const embeddings = await getEmbeddings(EMBEDDING_DIMENSIONS);
  const BATCH = 16;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vectors = await embeddings.embedDocuments(batch.map(embeddingText));
    await db.transaction(async (tx) => {
      for (const [j, row] of batch.entries())
        await tx.update(questions).set({ embedding: vectors[j] }).where(eq(questions.id, row.id));
    });
    log(`已生成 ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  return rows.length;
}
