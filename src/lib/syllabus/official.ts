import "server-only";
import { OFFICIAL_BASE } from "@/lib/papers/official";

/**
 * The official syllabus: https://gesp.ccf.org.cn/101/1008/10012.html
 * (认证资料 → 认证大纲). A single PDF covers C++ and Python, 一级 to 八级.
 *
 * Used by `scripts/syllabus.ts` and the admin「更新考试大纲」.
 */

export const OFFICIAL_SYLLABUS_URL = `${OFFICIAL_BASE}/101/1008/10012.html`;
const UA = "Mozilla/5.0 (compatible; GESPLearner/1.0; +https://github.com/toweizhou/GESPLearner)";

/** Last known attachment, used when the page can't be reached or its markup changes. */
const FALLBACK_PDF_URL = `${OFFICIAL_BASE}/101/attach/1725701770182688.pdf`;

export type SyllabusSource = { pdfUrl: string; sourceUrl: string; title: string };

/**
 * The attachment link whose text names C++. The page also offers the 图形化编程
 * standard, which is a different document and must not be picked up.
 */
export async function fetchSyllabusSource(log: (msg: string) => void = () => {}): Promise<SyllabusSource> {
  const base = { sourceUrl: OFFICIAL_SYLLABUS_URL, title: "CCF 编程能力等级认证标准（C++）" };
  try {
    const res = await fetch(OFFICIAL_SYLLABUS_URL, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GET ${OFFICIAL_SYLLABUS_URL} → ${res.status}`);
    const html = await res.text();

    for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
      if (!/C\+\+/i.test(text) || /图形化/.test(text)) continue;
      log(`大纲附件：${text}`);
      return { ...base, pdfUrl: m[1], title: text };
    }
    log("大纲页面上没有找到 C++ 附件，改用已知链接");
  } catch (err) {
    log(`访问大纲页面失败（${err instanceof Error ? err.message : err}），改用已知链接`);
  }
  return { ...base, pdfUrl: FALLBACK_PDF_URL };
}
