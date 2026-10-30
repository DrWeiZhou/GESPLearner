/**
 * Converts a downloaded GESP PDF into `data/papers/<id>.json`.
 *
 *   bun scripts/parse.ts                 # every paper in data/sources.json that has no JSON yet
 *   bun scripts/parse.ts cpp-2026-06-l3  # one paper
 *   bun scripts/parse.ts --force --level 3
 *
 * Why a vision model: the papers render formulas as vector paths, so the PDF text
 * layer loses them. We send page images AND the reading-order text — the text keeps
 * code and wording exact, the images recover formulas, answer tables and layout.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel } from "../src/lib/ai/model";
import { PaperSchema, type Paper } from "../src/lib/schema/paper";
import type { SourcePaper } from "./crawl";
import { extractPagesText, renderPages } from "./lib/pdf";

const DATA_DIR = path.join(process.cwd(), "data");

const SYSTEM = `你是一位严谨的试题录入专家，负责把 CCF GESP 的 C++ 认证真题 PDF 转录成结构化 JSON。

输出要求（务必严格遵守）：
1. 只输出一个 JSON 对象，不要任何解释文字、不要 Markdown 代码围栏。
2. JSON 结构：
{
  "questions": [
    { "type": "single_choice", "number": 1, "score": 2, "stem": "...", "options": [{"label":"A","content":"..."}, ...4个], "answer": "A" },
    { "type": "true_false", "number": 1, "score": 2, "stem": "...", "answer": "T" },
    { "type": "programming", "number": 1, "score": 25, "title": "试题名称", "timeLimitMs": 1000, "memoryLimitMb": 512,
      "description": "...", "inputFormat": "...", "outputFormat": "...",
      "samples": [{"input": "...", "output": "...", "explanation": "..."}],
      "dataRange": "...", "referenceSolution": "完整的参考程序源码" }
  ]
}
3. 题型顺序：先全部单选题（1~15），再全部判断题（1~10），最后编程题（1~2）。各题型的 number 均从 1 开始。
4. 判断题 answer：正确(√)填 "T"，错误(×)填 "F"。答案一律以试卷开头的「答案表格」为准。
5. 所有文本字段使用 Markdown：
   - 行内公式用 $...$，独立公式用 $$...$$（例如 $(0000\\,0101)_2$、$2 \\le n \\le 20000$）。
   - 代码块用 \`\`\`cpp 围栏，保留原始缩进，删除 PDF 左侧的行号。
   - 选项 content 不含 "A." 前缀；若选项本身是代码，content 就是一个代码块。
   - 题干不含 "第 N 题"；题干中的填空括号保留为「（ ）」。
   - 程序填空题的横线保留为 \`_____\`。
6. 分数从各部分标题读取（如「单选题（每题 2 分，共 30 分）」→ score 2）。
7. 编程题：timeLimitMs 由「时间限制 1.0 s」换算为 1000；memoryLimitMb 由「512.0 MB」得 512；
   samples 的 input/output 必须与试卷完全一致（注意行首/行尾空格）；referenceSolution 为纯源码（不要代码围栏）。
8. 不要编造解析；没有的字段就省略。`;

type ParsedPaper = { questions: Paper["questions"] };

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("模型没有返回 JSON");
  return body.slice(start, end + 1);
}

async function parsePaper(source: SourcePaper): Promise<Paper> {
  const pdf = new Uint8Array(await readFile(path.join(process.cwd(), source.pdfFile)));
  const [images, texts] = await Promise.all([renderPages(pdf, 2), extractPagesText(pdf)]);

  const content: Record<string, unknown>[] = [
    {
      type: "text",
      text: `请把下面这份《${source.examTitle} C++ ${source.level}级》试卷转录成 JSON。
共 ${images.length} 页，先给出每页的文字层（代码和文字准确，但公式缺失），随后是每页的图片（用于补全公式、答案表格和版面）。`,
    },
    ...texts.map((t, i) => ({ type: "text", text: `===== 第 ${i + 1} 页文字层 =====\n${t}` })),
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${Buffer.from(img).toString("base64")}` },
    })),
  ];

  const model = getChatModel({ vision: true, temperature: 0 });
  const res = await model.invoke([new SystemMessage(SYSTEM), new HumanMessage({ content: content as never })]);
  const parsed = JSON.parse(extractJSON(res.text)) as ParsedPaper;

  return PaperSchema.parse({
    id: source.id,
    language: "cpp",
    level: source.level,
    exam: { id: source.examId, title: `${source.examTitle}`, sourceUrl: source.sourceUrl },
    pdfUrl: source.pdfUrl,
    durationMinutes: 120,
    questions: parsed.questions,
  } satisfies Paper);
}

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
      const paper = await parsePaper(source);
      await writeFile(out, JSON.stringify(paper, null, 2) + "\n");
      const counts = paper.questions.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.type]: (acc[q.type] ?? 0) + 1 }), {});
      console.log(`✓ 单选 ${counts.single_choice ?? 0} / 判断 ${counts.true_false ?? 0} / 编程 ${counts.programming ?? 0}`);
      ok++;
    } catch (err) {
      console.log(`✗ ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    }
  }
  console.log(`完成：${ok}/${targets.length}`);
}

await main();
