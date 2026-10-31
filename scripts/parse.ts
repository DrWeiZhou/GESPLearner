/**
 * Converts a downloaded GESP PDF into `data/papers/<id>.json` (see src/lib/papers/parse.ts).
 *
 *   bun scripts/parse.ts                 # every paper in data/sources.json that has no JSON yet
 *   bun scripts/parse.ts cpp-2026-06-l3  # one paper
 *   bun scripts/parse.ts --force --level 3
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourcePaper } from "../src/lib/papers/official";
import { countQuestions, parsePaperPdf } from "../src/lib/papers/parse";

const DATA_DIR = path.join(process.cwd(), "data");

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const levelArg = args.indexOf("--level");
  const level = levelArg >= 0 ? Number(args[levelArg + 1]) : null;
  const ids = args.filter((a) => a.startsWith("cpp-"));

  const sources = JSON.parse(await readFile(path.join(DATA_DIR, "sources.json"), "utf8")) as SourcePaper[];
  const targets = sources.filter(
    (s) => (ids.length === 0 || ids.includes(s.id)) && (level === null || s.level === level),
  );
  await mkdir(path.join(DATA_DIR, "papers"), { recursive: true });

  let ok = 0;
  for (const source of targets) {
    const out = path.join(DATA_DIR, "papers", `${source.id}.json`);
    if (!force && (await Bun.file(out).exists())) continue;
    process.stdout.write(`解析 ${source.id} … `);
    try {
      const pdf = new Uint8Array(await readFile(path.join(process.cwd(), source.pdfFile)));
      const paper = await parsePaperPdf(source, pdf);
      await writeFile(out, JSON.stringify(paper, null, 2) + "\n");
      const counts = countQuestions(paper);
      console.log(`✓ 单选 ${counts.single_choice} / 判断 ${counts.true_false} / 编程 ${counts.programming}`);
      ok++;
    } catch (err) {
      console.log(`✗ ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    }
  }
  console.log(`完成：${ok}/${targets.length}`);
}

await main();
// the settings lookup may have opened a database connection
process.exit(0);
