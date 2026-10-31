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

const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

type DetailPage = { url: string; title: string; date: string };

/** The list is paginated as index.html, index_2.html, … */
async function collectDetailPages(): Promise<DetailPage[]> {
  const pages = new Map<string, DetailPage>();
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
      // anchor text is "<title> <YYYY-MM-DD> <summary>"
      const [, title, date] = stripTags(m[3]).match(/^(.*?)\s+(\d{4}-\d{2}-\d{2})/) ?? [];
      if (title) pages.set(`${BASE}${m[1]}`, { url: `${BASE}${m[1]}`, title, date });
    }
    if (pages.size === before) break;
  }
  return [...pages.values()];
}

/**
 * "2026年9月GESP认证真题" → "2026-09". Older titles omit the year
 * ("GESP 6月份认证真题"), so fall back to the publish date's year.
 */
function parseExamId(title: string, date: string): string | null {
  const month = title.match(/(\d{1,2})\s*月/);
  const year = title.match(/(\d{4})\s*年/)?.[1] ?? date.slice(0, 4);
  return month && year ? `${year}-${month[1].padStart(2, "0")}` : null;
}

/** "C++ 3级" / "C++一级" → 3 / 1 */
function parseLevel(text: string): number | null {
  const m = text.match(/C\+\+\s*([1-8一二三四五六七八])\s*级/i);
  if (!m) return null;
  return /\d/.test(m[1]) ? Number(m[1]) : "一二三四五六七八".indexOf(m[1]) + 1;
}

async function main() {
  const force = process.argv.includes("--force");
  await mkdir(path.join(DATA_DIR, "pdf"), { recursive: true });

  const details = await collectDetailPages();
  console.log(`找到 ${details.length} 个真题页面`);

  const papers: SourcePaper[] = [];
  for (const { url, title, date } of details) {
    // 2023 年的「真题解析」合集页，不是试卷
    if (title.includes("解析")) {
      console.warn(`跳过（解析合集）：${title}`);
      continue;
    }
    const examId = parseExamId(title, date);
    if (!examId) {
      console.warn(`跳过（无法解析考试场次）：${title}`);
      continue;
    }
    const html = await fetchText(url);
    const examTitle = `${examId.split("-")[0]}年${Number(examId.split("-")[1])}月GESP认证`;

    for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = stripTags(m[2]);
      // e.g. "CCF GESP 2026年9月认证 C++ 3级试题" / "GESP 6月认证C++一级真题"
      const level = parseLevel(text);
      if (!level) continue; // skip 图形化 / Python
      const id = paperId(examId, level);
      if (papers.some((p) => p.id === id)) continue;
      papers.push({
        id,
        examId,
        examTitle,
        level,
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
