import "server-only";
import { paperId } from "@/lib/schema/paper";

/**
 * The official paper index: https://gesp.ccf.org.cn/101/1010/index.html
 * (认证资料 → 真题及解析). Each exam session has a detail page linking one PDF per
 * language × level; we keep the C++ ones.
 *
 * Used by `scripts/crawl.ts`, `scripts/update.ts` and the admin「更新题库」.
 */

export const OFFICIAL_BASE = "https://gesp.ccf.org.cn";
export const OFFICIAL_LIST_URL = `${OFFICIAL_BASE}/101/1010/index.html`;
const UA = "Mozilla/5.0 (compatible; GESPLearner/1.0; +https://github.com/toweizhou/GESPLearner)";

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
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
};

export async function downloadPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`下载 PDF 失败（${res.status}）`);
  return new Uint8Array(await res.arrayBuffer());
}

const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

type DetailPage = { url: string; title: string; date: string };

/** The list is paginated as index.html, index_2.html, … */
async function collectDetailPages(): Promise<DetailPage[]> {
  const pages = new Map<string, DetailPage>();
  for (let page = 1; ; page++) {
    const url = page === 1 ? OFFICIAL_LIST_URL : `${OFFICIAL_BASE}/101/1010/index_${page}.html`;
    let html: string;
    try {
      html = await fetchText(url);
    } catch (err) {
      // Past the last page the site answers 404; failing on page 1 means the site is unreachable.
      if (page === 1) throw err;
      break;
    }
    const before = pages.size;
    for (const m of html.matchAll(/<a[^>]+href="(\/101\/1010\/(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/g)) {
      // anchor text is "<title> <YYYY-MM-DD> <summary>"
      const [, title, date] = stripTags(m[3]).match(/^(.*?)\s+(\d{4}-\d{2}-\d{2})/) ?? [];
      if (title) pages.set(`${OFFICIAL_BASE}${m[1]}`, { url: `${OFFICIAL_BASE}${m[1]}`, title, date });
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

/**
 * Links on the official site that point at the wrong file. The 2023-09「C++五级真题」
 * link serves the 六级 paper; the real 五级 paper only exists inside the 解析 PDF.
 */
const LINK_FIXES: Partial<Record<string, Pick<SourcePaper, "pdfUrl" | "sourceUrl">>> = {
  "cpp-2023-09-l5": {
    pdfUrl: `${OFFICIAL_BASE}/101/attach/1580976341778464.pdf`,
    sourceUrl: `${OFFICIAL_BASE}/101/1010/10100.html`,
  },
};

export const examTitleOf = (examId: string) =>
  `${examId.split("-")[0]}年${Number(examId.split("-")[1])}月GESP认证`;

/** Every C++ paper on the official site, newest exam first. */
export async function fetchOfficialPapers(log: (msg: string) => void = () => {}): Promise<SourcePaper[]> {
  const details = await collectDetailPages();
  log(`找到 ${details.length} 个真题页面`);

  const papers: SourcePaper[] = [];
  for (const { url, title, date } of details) {
    // 2023 年的「真题解析」合集页，不是试卷
    if (title.includes("解析")) {
      log(`跳过（解析合集）：${title}`);
      continue;
    }
    const examId = parseExamId(title, date);
    if (!examId) {
      log(`跳过（无法解析考试场次）：${title}`);
      continue;
    }
    const html = await fetchText(url);
    const examTitle = examTitleOf(examId);

    for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = stripTags(m[2]);
      // e.g. "CCF GESP 2026年9月认证 C++ 3级试题" / "GESP 6月认证C++一级真题"
      const level = parseLevel(text);
      if (!level) continue; // skip 图形化 / Python
      const id = paperId(examId, level);
      if (papers.some((p) => p.id === id)) continue;
      const fix = LINK_FIXES[id];
      papers.push({
        id,
        examId,
        examTitle,
        level,
        pdfUrl: fix?.pdfUrl ?? m[1],
        sourceUrl: fix?.sourceUrl ?? url,
        pdfFile: `data/pdf/${id}.pdf`,
      });
    }
  }

  return papers.sort((a, b) => b.examId.localeCompare(a.examId) || a.level - b.level);
}
