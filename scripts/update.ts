/**
 * 一键更新题库 from the command line — the same flow as /admin →「更新题库」,
 * but it also keeps `data/sources.json`, `data/pdf/` and `data/papers/` in sync
 * so the repository stays the source of truth.
 *
 *   bun scripts/update.ts                 # new exams, at the levels already in the library
 *   bun scripts/update.ts --level 1 --level 3
 *   bun scripts/update.ts --all-missing   # also fill in missing papers of older exams
 *   bun scripts/update.ts --draft         # import without publishing
 *   bun scripts/update.ts --dry-run       # only report what would be imported
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadPdf, fetchOfficialPapers } from "../src/lib/papers/official";
import { checkForUpdates, importPaper } from "../src/lib/papers/sync";
import { PaperSchema } from "../src/lib/schema/paper";
import { loadTests } from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");
const args = process.argv.slice(2);
const levels = args.flatMap((a, i) => (a === "--level" ? [Number(args[i + 1])] : []));

const check = await checkForUpdates();
const wanted = new Set(levels.length ? levels : check.libraryLevels);
const targets = check.exams
  .filter((e) => e.isNew || args.includes("--all-missing"))
  .flatMap((e) => e.papers)
  .filter((p) => p.status === "missing" && (wanted.size === 0 || wanted.has(p.level)));

const latest = check.exams[0];
console.log(`官网最新：${latest?.examTitle ?? "—"}；新考试：${check.exams.filter((e) => e.isNew).map((e) => e.examId).join("、") || "无"}`);
console.log(`待导入 ${targets.length} 份：${targets.map((t) => t.id).join(" ") || "—"}`);
if (targets.length === 0 || args.includes("--dry-run")) process.exit(0);

// Refresh the local index the other scripts (parse, gen-tests) read.
await writeFile(path.join(DATA_DIR, "sources.json"), JSON.stringify(await fetchOfficialPapers(), null, 2) + "\n");
await mkdir(path.join(DATA_DIR, "pdf"), { recursive: true });
await mkdir(path.join(DATA_DIR, "papers"), { recursive: true });

let failed = 0;
for (const source of targets) {
  process.stdout.write(`导入 ${source.id} … `);
  try {
    const pdfFile = path.join(DATA_DIR, "pdf", `${source.id}.pdf`);
    if (!(await Bun.file(pdfFile).exists())) await Bun.write(pdfFile, await downloadPdf(source.pdfUrl));
    const jsonFile = path.join(DATA_DIR, "papers", `${source.id}.json`);
    const existing = (await Bun.file(jsonFile).exists())
      ? PaperSchema.parse(JSON.parse(await readFile(jsonFile, "utf8")))
      : undefined;

    const result = await importPaper(source, {
      publish: !args.includes("--draft"),
      pdf: new Uint8Array(await readFile(pdfFile)),
      // Reuse a JSON already parsed (and maybe hand-corrected) instead of paying for another parse.
      paper: existing,
      loadTests,
      onParsed: (paper) => writeFile(jsonFile, JSON.stringify(paper, null, 2) + "\n"),
    });
    const note = result.warnings.length ? `，存为草稿：${result.warnings.join("；")}` : "";
    console.log(`✓ ${result.questions} 题 / ${result.totalScore} 分（${result.status === "published" ? "已发布" : "草稿"}${note}）`);
    if (result.embedError) console.warn(`  向量生成失败：${result.embedError}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : err}`);
  }
}
console.log(`完成：${targets.length - failed}/${targets.length}`);
process.exit(failed ? 1 : 0);
