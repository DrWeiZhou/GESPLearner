import "server-only";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel } from "@/lib/ai/model";
import { PaperSchema, type Paper, type QuestionType } from "@/lib/schema/paper";
import type { SourcePaper } from "./official";
import { extractPagesText, findTrueFalseTable, renderBand, renderPages } from "./pdf";

/**
 * Converts a GESP PDF into a `Paper` with a vision model.
 *
 * Why a vision model: the papers render formulas as vector paths, so the PDF text
 * layer loses them. We send page images AND the reading-order text — the text keeps
 * code and wording exact, the images recover formulas, answer tables and layout.
 */

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
   - 注意这是 JSON：字符串里的每个反斜杠都要写成两个，例如 "stem": "$(0000\\\\,0101)_2$，$2 \\\\le n$"。
   - 代码块用 \`\`\`cpp 围栏，保留原始缩进，删除 PDF 左侧的行号。
   - 选项 content 不含 "A." 前缀；若选项本身是代码，content 就是一个代码块。
   - 题干不含 "第 N 题"；题干中的填空括号保留为「（ ）」。
   - 程序填空题的横线保留为 \`_____\`。
6. 分数从各部分标题读取（如「单选题（每题 2 分，共 30 分）」→ score 2）。
7. 编程题：timeLimitMs 由「时间限制 1.0 s」换算为 1000；memoryLimitMb 由「512.0 MB」得 512；
   samples 的 input/output 必须与试卷完全一致（注意行首/行尾空格）；referenceSolution 为纯源码（不要代码围栏）。
8. 不要编造解析；没有的字段就省略。`;

type ParsedPaper = { questions: Paper["questions"] };

export function extractJSON(text: string): string {
  // GLM-4.5V wraps its answer in <|begin_of_box|>…<|end_of_box|>. A ```json fence needs no
  // special handling (and matching one would catch the ```cpp blocks inside the stems).
  const body = text.replace(/<\|(?:begin|end)_of_box\|>/g, "");
  const start = body.indexOf("{");
  if (start === -1) throw new Error("模型没有返回 JSON");

  // End at the brace that closes the first object: models sometimes add a stray "}" after it.
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return body.slice(start, i + 1);
  }
  throw new Error("模型返回的 JSON 不完整（可能输出被截断）");
}

/**
 * LaTeX commands whose first letter is also a JSON escape (\b \f \n \r \t): written
 * with a single backslash they still parse, but as control characters.
 */
const LATEX_COMMANDS = new Set(
  ("bar beta bf big bigl bigr binom bmod boxed bullet because bot " +
    "frac forall " +
    "ne neq neg nabla not notin ni nu nleq ngeq nmid " +
    "right rightarrow rho rangle rceil rfloor rm " +
    "text textbf textit texttt times to tau theta top triangle tfrac").split(" "),
);

/**
 * Models often copy LaTeX into JSON strings without doubling the backslashes:
 * `\,` makes JSON.parse fail, `\frac` silently becomes a form feed + "rac". Inside
 * string literals, double every backslash that isn't a real escape, treating
 * `\` + a known LaTeX command as LaTeX rather than \f, \n, \t, ….
 */
export function repairBackslashes(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    if (c === '"') {
      inString = false;
      out += c;
      continue;
    }
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = json[i + 1] ?? "";
    const word = json.slice(i + 1).match(/^[A-Za-z]+/)?.[0] ?? "";
    const isEscape =
      next === '"' ||
      next === "\\" ||
      next === "/" ||
      (next === "u" && /^[0-9a-fA-F]{4}/.test(json.slice(i + 2))) ||
      ("bfnrt".includes(next) && next !== "" && !LATEX_COMMANDS.has(word));
    if (isEscape) {
      out += c + next;
      i++;
    } else {
      out += "\\\\";
    }
  }
  return out;
}

/**
 * The single-choice answer row printed on the first page ("答案 D D A C …"), read
 * straight from the text layer. The model doesn't always copy it faithfully and
 * re-solves some questions instead, so the printed key wins. (The true/false row is
 * drawn as √/× glyphs with no text, so only the model can read that one.)
 */
export function singleChoiceKey(texts: string[]): string[] | null {
  for (const m of texts.slice(0, 2).join("\n").matchAll(/^答案\s*(.*)$/gm)) {
    const row = m[1].trim().split(/\s+/);
    if (row.length === 15 && row.every((x) => /^[A-D]$/.test(x))) return row;
  }
  return null;
}

/**
 * The 判断题 key is a row of small √/× marks drawn as vector paths, which the model
 * misreads on a full page. Crop just that table at high resolution and ask only for
 * the ten marks. Returns null when the table can't be found or read; the caller
 * then keeps the model's answers.
 */
export async function readTrueFalseKey(pdf: Uint8Array): Promise<("T" | "F")[] | null> {
  const table = await findTrueFalseTable(pdf);
  if (!table) return null;
  const image = await renderBand(pdf, table.page, table.top, table.bottom);
  const model = await getChatModel({ vision: true, temperature: 0, maxTokens: 200 });
  const res = await model.invoke([
    new HumanMessage({
      content: [
        {
          type: "text",
          text: "图中是一张判断题答案表：第一行是题号 1~10，第二行是对应答案，√ 表示正确，× 表示错误。请按题号顺序逐个读出答案，√ 写 T，× 写 F，只输出 10 个字母，用空格分隔，不要其他内容。",
        },
        { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(image).toString("base64")}` } },
      ] as never,
    }),
  ]);
  const marks = res.text.replace(/<\|(?:begin|end)_of_box\|>/g, "").match(/[TF]/g);
  return marks?.length === 10 ? (marks as ("T" | "F")[]) : null;
}

export async function parsePaperPdf(source: Omit<SourcePaper, "pdfFile">, pdf: Uint8Array): Promise<Paper> {
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

  // A paper is ~8k output tokens. Without a cap some gateways default max_tokens to the whole
  // context window and then reject the request, since the ~30k-token prompt no longer fits.
  const model = await getChatModel({ vision: true, temperature: 0, maxTokens: 16_384 });
  const res = await model.invoke([new SystemMessage(SYSTEM), new HumanMessage({ content: content as never })]);

  let parsed: ParsedPaper;
  try {
    parsed = JSON.parse(repairBackslashes(extractJSON(res.text))) as ParsedPaper;
  } catch (err) {
    throw new Error(`模型返回的内容不是合法 JSON（${err instanceof Error ? err.message : err}）`);
  }

  const result = PaperSchema.safeParse({
    id: source.id,
    language: "cpp",
    level: source.level,
    exam: { id: source.examId, title: source.examTitle, sourceUrl: source.sourceUrl },
    pdfUrl: source.pdfUrl,
    durationMinutes: 120,
    questions: parsed.questions,
  } satisfies Paper);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`模型返回的 JSON 不符合试卷格式：${issue.path.join(".")} ${issue.message}`);
  }

  const scKey = singleChoiceKey(texts);
  const tfKey = await readTrueFalseKey(pdf).catch(() => null);
  for (const q of result.data.questions) {
    if (q.type === "single_choice" && scKey?.[q.number - 1]) q.answer = scKey[q.number - 1] as typeof q.answer;
    if (q.type === "true_false" && tfKey?.[q.number - 1]) q.answer = tfKey[q.number - 1];
  }
  return result.data;
}

/** Every GESP C++ paper so far: 15 单选 + 10 判断 + 2 编程, 100 分. */
const EXPECTED: Record<QuestionType, number> = { single_choice: 15, true_false: 10, programming: 2 };
const TYPE_LABEL: Record<QuestionType, string> = { single_choice: "单选", true_false: "判断", programming: "编程" };

export const countQuestions = (paper: Paper) =>
  paper.questions.reduce<Record<QuestionType, number>>(
    (acc, q) => ({ ...acc, [q.type]: acc[q.type] + 1 }),
    { single_choice: 0, true_false: 0, programming: 0 },
  );

/**
 * Sanity checks on a freshly parsed paper. Anything listed here usually means the
 * model skipped or merged questions, so the paper should be reviewed before students see it.
 */
export function checkPaperShape(paper: Paper): string[] {
  const warnings: string[] = [];
  const counts = countQuestions(paper);
  for (const type of Object.keys(EXPECTED) as QuestionType[]) {
    if (counts[type] !== EXPECTED[type]) warnings.push(`${TYPE_LABEL[type]}题 ${counts[type]} 道（应为 ${EXPECTED[type]} 道）`);
    const numbers = paper.questions.filter((q) => q.type === type).map((q) => q.number);
    if (new Set(numbers).size !== numbers.length) warnings.push(`${TYPE_LABEL[type]}题题号重复`);
  }
  const total = paper.questions.reduce((s, q) => s + q.score, 0);
  if (total !== 100) warnings.push(`总分 ${total} 分（应为 100 分）`);
  return warnings;
}
