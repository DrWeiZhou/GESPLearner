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
import { paperId } from "../src/lib/schema/paper";

const BASE = "https://gesp.ccf.org.cn";
const LIST_URL = `${BASE}/101/1010/index.html`;
const UA = "Mozilla/5.0 (compatible; GESPLearner/1.0; +https://github.com/toweizhou/GESPLearner)";
const DATA_DIR = path.join(process.cwd(), "data");

export type SourcePaper = {
  id: string;
  examId: string;
  examTitle: string;
  level: number;
  pdfUrl: string;
  sourceUrl: string;
  pdfFile: string;
};

const fetchText = async (url: string) => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
};

const stripTags = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** The list is paginated as index.html, index_2.html, … */
async function collectDetailPages(): Promise<{ url: string; title: string }[]> {
  const pages = new Map<string, string>();
  for (let page = 1; ; page++) {
    const url = page === 1 ? LIST_URL : `${BASE}/101/1010/index_${page}.html`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch {
      break;
    }
    const before = pages.size;
    for (const m of html.matchAll(/<a[^>]+href="(\/101\/1010\/(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const title = stripTags(m[3]);
      if (title) pages.set(`${BASE}${m[1]}`, title.split(/\s+\d{4}-\d{2}-\d{2}/)[0]);
    }
    if (pages.size === before) break;
  }
  return [...pages].map(([url, title]) => ({ url, title }));
}

/** "2026年9月GESP认证真题" → "2026-09" */
function parseExamId(title: string): string | null {
  const m = title.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
}

async function main() {
  const force = process.argv.includes("--force");
  await mkdir(path.join(DATA_DIR, "pdf"), { recursive: true });

  const details = await collectDetailPages();
  console.log(`找到 ${details.length} 个真题页面`);

  const papers: SourcePaper[] = [];
  for (const { url, title } of details) {
    const examId = parseExamId(title);
    if (!examId) {
      console.warn(`跳过（无法解析考试场次）：${title}`);
      continue;
    }
    const html = await fetchText(url);
    const examTitle = `${examId.split("-")[0]}年${Number(examId.split("-")[1])}月GESP认证`;

    for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = stripTags(m[2]);
      // e.g. "CCF GESP 2026年9月认证 C++ 3级试题"
      const level = text.match(/C\+\+\s*(\d)\s*级/i);
      if (!level) continue; // skip 图形化 / Python
      const id = paperId(examId, Number(level[1]));
      papers.push({
        id,
        examId,
        examTitle,
        level: Number(level[1]),
        pdfUrl: m[1],
        sourceUrl: url,
        pdfFile: `data/pdf/${id}.pdf`,
      });
    }
  }

  papers.sort((a, b) => b.examId.localeCompare(a.examId) || a.level - b.level);
  await writeFile(path.join(DATA_DIR, "sources.json"), JSON.stringify(papers, null, 2) + "\n");
  console.log(`写入 data/sources.json：${papers.length} 份 C++ 试卷`);

  let downloaded = 0;
  for (const p of papers) {
    const file = path.join(process.cwd(), p.pdfFile);
    if (!force && (await Bun.file(file).exists())) continue;
    const res = await fetch(p.pdfUrl, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.warn(`下载失败 ${p.id}: ${res.status}`);
      continue;
    }
    await Bun.write(file, await res.arrayBuffer());
    downloaded++;
    console.log(`下载 ${p.id}`);
  }
  console.log(`新下载 ${downloaded} 个 PDF（共 ${papers.length}）`);
}

await main();
