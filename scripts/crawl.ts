/**
 * Crawls https://gesp.ccf.org.cn/101/1010/index.html (认证资料 → 真题及解析)
 * and writes the C++ paper index to `data/sources.json`.
 *
 *   bun scripts/crawl.ts [--force]
 *
 * Also downloads each PDF into `data/pdf/` (skipped when already present).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadPdf, fetchOfficialPapers } from "../src/lib/papers/official";

const DATA_DIR = path.join(process.cwd(), "data");

async function main() {
  const force = process.argv.includes("--force");
  await mkdir(path.join(DATA_DIR, "pdf"), { recursive: true });

  const papers = await fetchOfficialPapers(console.log);
  await writeFile(path.join(DATA_DIR, "sources.json"), JSON.stringify(papers, null, 2) + "\n");
  console.log(`写入 data/sources.json：${papers.length} 份 C++ 试卷`);

  let downloaded = 0;
  for (const p of papers) {
    const file = path.join(process.cwd(), p.pdfFile);
    if (!force && (await Bun.file(file).exists())) continue;
    try {
      await Bun.write(file, await downloadPdf(p.pdfUrl));
    } catch (err) {
      console.warn(`下载失败 ${p.id}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    downloaded++;
    console.log(`下载 ${p.id}`);
  }
  console.log(`新下载 ${downloaded} 个 PDF（共 ${papers.length}）`);
}

await main();
