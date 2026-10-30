/**
 * Imports `data/papers/*.json` into Postgres (idempotent upsert).
 *
 *   bun scripts/seed.ts                  # all papers
 *   bun scripts/seed.ts cpp-2026-09-l3   # one paper
 *   bun scripts/seed.ts --draft          # import without publishing
 *
 * Also loads `data/tests/<questionId>.json` (see scripts/gen-tests.ts) as hidden
 * test cases; sample cases always come from the paper itself.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { exams, papers, questionKeys, questions, testCases } from "../src/db/schema";
import { PaperSchema, questionId, type Paper } from "../src/lib/schema/paper";

const DATA_DIR = path.join(process.cwd(), "data");

type StoredCase = { idx: number; input: string; expectedOutput: string; isSample: boolean };

async function loadTests(qid: string): Promise<StoredCase[] | null> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, "tests", `${qid}.json`), "utf8")) as StoredCase[];
  } catch {
    return null;
  }
}

async function seedPaper(paper: Paper, publish: boolean) {
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

      const generated = await loadTests(id);
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

async function main() {
  const args = process.argv.slice(2);
  const publish = !args.includes("--draft");
  const only = args.filter((a) => a.startsWith("cpp-"));

  const dir = path.join(DATA_DIR, "papers");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const targets = files.filter((f) => only.length === 0 || only.includes(f.replace(/\.json$/, "")));

  for (const file of targets) {
    const paper = PaperSchema.parse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
    const total = await seedPaper(paper, publish);
    console.log(`✓ ${paper.id}：${paper.questions.length} 题 / ${total} 分${publish ? "（已发布）" : "（草稿）"}`);
  }
  console.log(`完成：${targets.length} 份试卷`);
  process.exit(0);
}

await main();
