import "server-only";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel } from "@/lib/ai/model";
import { extractPagesText } from "@/lib/papers/pdf";
import { extractJSON, repairBackslashes } from "@/lib/papers/parse";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import { SyllabusSchema, type Syllabus } from "@/lib/schema/syllabus";
import type { SyllabusSource } from "./official";

/**
 * Turns the official syllabus PDF into one `Syllabus` per C++ level.
 *
 * The PDF holds all eight levels for both languages, each as a section headed
 * "C++ 编程N级标准" / "C++&Python 编程N级标准" (三级 and up share one section with
 * Python). We cut it into those sections and hand one level at a time to the model:
 * a whole 31-page document in one call loses detail, and a level is self-contained.
 *
 * Unlike the papers (see lib/papers/parse), this needs no vision model: the syllabus
 * is plain prose and tables, all of it in the PDF's text layer. The only picture is
 * the 「知识块」 diagram, which repeats the 知识块 column of the table beside it.
 */

const SYSTEM = `你是一位 GESP 教研老师，正在把《CCF 编程能力等级认证标准》中某一个级别的内容整理成结构化的知识点清单。

输出要求（务必严格遵守）：
1. 只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码围栏。
2. JSON 结构：
{
  "objective": "（二）考核目标的概括，1~2 句话",
  "points": [
    { "block": "知识块名称", "name": "知识点名称", "summary": "一句话说明这个知识点包含哪些内容" }
  ]
}
3. 以「（四）知识点描述」表格中的「知识块 / 知识点」为主干，再结合「（一）知识点详述」补齐表格漏掉的内容。
4. 粒度要求：一个知识点大致相当于「一次课能讲完的一个主题」。
   - 单元格里并列的若干项如果属于同一个主题，合并成一个知识点，并把它们写进 summary：
     「二进制、八进制、十进制、十六进制」合并为「进制转换」；
     「与、或、非、异或、左移、右移」合并为「位运算」；
     「大小写转换、搜索、分割、替换」合并为「字符串函数」。
   - 只有并列的几项本身就是不同主题时才拆开：「顺序结构、分支结构、循环结构」拆成三条。
5. name 为 2~12 个字的名词短语（如「位运算」「二分查找」「结构体」），必须具体到能用来判断一道题考什么；
   不要出现「其他」「综合应用」「基础知识」这类无法判定的名称；同一级别内不得重复。
6. block 用大纲里的知识块名称；同一个知识块下的知识点要连续排列，顺序与大纲一致。
7. summary 只描述该级别大纲要求的范围，不要扩展到更高级别的内容。
8. 本级别一般有 8~18 个知识点，宁可粗一点也不要把同一个主题拆散。只整理 C++ 的要求，忽略 Python 专有内容。`;

type ParsedSyllabus = { objective?: string; points: { block: string; name: string; summary?: string }[] };

/** "C++ 编程三级标准" / "C++&Python 编程三级标准" / "Python 编程一级标准" */
const HEADER_RE = /(C\+\+(?:&Python)?|Python)编程([一二三四五六七八])级标准/;

export type LevelSection = { level: number; from: number; to: number };

/**
 * The 1-based page range of each C++ level inside the syllabus PDF. A section runs
 * from its heading to the page before the next heading of any language.
 */
export function splitLevels(pages: string[]): LevelSection[] {
  const heads: { page: number; level: number; cpp: boolean }[] = [];
  for (const [i, text] of pages.entries()) {
    const m = text.replace(/\s+/g, "").match(HEADER_RE);
    if (!m) continue;
    heads.push({ page: i + 1, level: "一二三四五六七八".indexOf(m[2]) + 1, cpp: m[1] !== "Python" });
  }
  return heads.flatMap((h, i) =>
    h.cpp ? [{ level: h.level, from: h.page, to: (heads[i + 1]?.page ?? pages.length + 1) - 1 }] : [],
  );
}

export type SyllabusPdf = { texts: string[]; sections: LevelSection[] };

/** Reads and splits the PDF once, so importing eight levels downloads it once. */
export async function readSyllabusPdf(pdf: Uint8Array): Promise<SyllabusPdf> {
  const texts = await extractPagesText(pdf);
  const sections = splitLevels(texts);
  if (sections.length === 0) throw new Error("大纲 PDF 中没有找到「C++ 编程N级标准」章节，官方文件可能已改版");
  return { texts, sections };
}

export async function parseSyllabusLevel(
  level: number,
  { texts, sections }: SyllabusPdf,
  source: SyllabusSource,
): Promise<Syllabus> {
  const section = sections.find((s) => s.level === level);
  if (!section) throw new Error(`大纲 PDF 中没有 C++ ${LEVEL_NAMES[level]} 的章节`);

  const body = texts
    .slice(section.from - 1, section.to)
    .map((t, i) => `===== 第 ${section.from + i} 页 =====\n${t}`)
    .join("\n\n");

  const model = await getChatModel({ temperature: 0, maxTokens: 4096 });
  const res = await model.invoke([
    new SystemMessage(SYSTEM),
    new HumanMessage(
      `下面是《${source.title}》中 C++ ${LEVEL_NAMES[level]}（第 ${section.from}~${section.to} 页）的内容。
文字按版面从上到下抽取，表格的单元格会被拆成多行，请结合上下文还原。

${body}`,
    ),
  ]);

  let parsed: ParsedSyllabus;
  try {
    parsed = JSON.parse(repairBackslashes(extractJSON(res.text))) as ParsedSyllabus;
  } catch (err) {
    throw new Error(`模型返回的内容不是合法 JSON（${err instanceof Error ? err.message : err}）`);
  }

  // Two points with the same name would collide on their id (see `knowledgePointId`).
  const byName = new Map<string, { block: string; name: string; summary: string }>();
  for (const p of parsed.points ?? []) {
    const point = { block: p.block?.trim() ?? "", name: p.name?.trim() ?? "", summary: p.summary?.trim() ?? "" };
    if (point.name && point.block && !byName.has(point.name)) byName.set(point.name, point);
  }
  const points = [...byName.values()];

  const result = SyllabusSchema.safeParse({
    level,
    language: "cpp",
    objective: parsed.objective?.trim() ?? "",
    pdfUrl: source.pdfUrl,
    sourceUrl: source.sourceUrl,
    pages: [section.from, section.to],
    points,
  } satisfies Syllabus);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`模型返回的 JSON 不符合大纲格式：${issue.path.join(".")} ${issue.message}`);
  }
  return result.data;
}
