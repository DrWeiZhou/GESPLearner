import "server-only";
import { inArray } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getDb, isDatabaseConfigured } from "@/db";
import { questionKnowledge } from "@/db/schema";
import { getChatModel, loadAIConfig } from "@/lib/ai/model";
import { getAnswerKeys, getQuestion } from "@/lib/content";
import { QUESTION_TYPE_LABEL } from "@/lib/format";
import { extractJSON } from "@/lib/papers/parse";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import { candidatePoints, type KnowledgePointView } from "@/lib/syllabus/content";
import type { PublicQuestion } from "@/lib/types";

/**
 * Deciding which syllabus knowledge point a question examines.
 *
 * The verdict belongs to the question, not to the student who missed it, so it is
 * worked out once — the first time anyone gets the question wrong — and stored in
 * `question_knowledge` for everyone. Every later wrong answer on the same question
 * reuses it, which keeps the wrong-answer book grouped without a model call per
 * student.
 *
 * Classification runs after the response (see `after()` in the grading routes), so
 * a slow or unreachable model never delays grading; the wrong-answer book asks for
 * anything still missing when it is opened.
 */

const SYSTEM = `你是 CCF GESP 的命题分析老师，负责判断一道 C++ 真题主要考查大纲中的哪一个知识点。

输出要求：
1. 只输出一个 JSON 对象，不要解释文字，不要 Markdown 代码围栏：{"id": "知识点编号", "reason": "判定理由"}
2. id 必须原样抄写候选清单中的某个编号；确实无法归入任何一条时填 null。
3. reason 用简体中文，不超过 30 字，说明这道题考查了该知识点的什么内容。
4. 认准「解这道题必须掌握的核心知识」：题面出现的语法不等于考点，例如用循环输出结果、
   但真正要想明白的是进制转换时，应归到进制转换。
5. GESP 的级别是累积的，低级别的知识点同样可能是高级别题目的考点。`;

/** How many questions one call may classify, so an `after()` task can't run away. */
const MAX_PER_RUN = 12;

export type Verdict = { id: string | null; reason: string };

function questionBlock(q: PublicQuestion, answer: string | null) {
  const head = `【${QUESTION_TYPE_LABEL[q.type]}】`;
  if (q.type === "programming") {
    return `${head}${q.title}\n${q.description}\n输入：${q.inputFormat}\n输出：${q.outputFormat}\n${q.dataRange ?? ""}`;
  }
  const options = q.type === "single_choice" ? `\n${q.options.map((o) => `${o.label}. ${o.content}`).join("\n")}` : "";
  return `${head}${q.stem}${options}\n正确答案：${answer ?? "未知"}`;
}

const candidateList = (points: KnowledgePointView[]) =>
  points.map((p) => `${p.id} | ${LEVEL_NAMES[p.level]} | ${p.block} | ${p.name}${p.summary ? ` —— ${p.summary}` : ""}`).join("\n");

/**
 * The prompt and the answer parsing are split out so a classification can be
 * reproduced against a level's knowledge points without touching the database.
 */
export function buildClassifyMessages(params: {
  level: number;
  question: PublicQuestion;
  answer: string | null;
  explanation: string | null;
  points: KnowledgePointView[];
}) {
  const { level, question, answer, explanation, points } = params;
  return [
    new SystemMessage(SYSTEM),
    new HumanMessage(
      `这是一道 GESP C++ ${LEVEL_NAMES[level]} 的真题：

${questionBlock(question, answer)}
${explanation ? `\n官方解析：${explanation}\n` : ""}
候选知识点（编号 | 级别 | 知识块 | 知识点）：
${candidateList(points)}`,
    ),
  ];
}

export function parseVerdict(text: string, points: KnowledgePointView[]): Verdict {
  let parsed: { id?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(extractJSON(text)) as typeof parsed;
  } catch {
    return { id: null, reason: "模型未返回可用的判定结果" };
  }
  // Only an id the model copied from the candidate list counts; anything else is a
  // hallucination and the question is left unclassified rather than mis-filed.
  const id = typeof parsed.id === "string" && points.some((p) => p.id === parsed.id) ? parsed.id : null;
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 120) : "";
  return { id, reason: reason || (id ? "" : "模型无法把这道题归入大纲中的某一个知识点") };
}

/** One model call for one question. Returns null when the question no longer exists. */
export async function classifyQuestion(questionId: string): Promise<Verdict | null> {
  const found = await getQuestion(questionId);
  if (!found) return null;

  const points = await candidatePoints(found.paper.level);
  if (points.length === 0) throw new Error(`C++ ${LEVEL_NAMES[found.paper.level]} 的考试大纲尚未导入`);

  const key = (await getAnswerKeys([questionId])).get(questionId);
  const model = await getChatModel({ temperature: 0, maxTokens: 300 });
  const res = await model.invoke(
    buildClassifyMessages({
      level: found.paper.level,
      question: found.question,
      answer: key?.answer ?? null,
      explanation: key?.explanation ?? null,
      points,
    }),
  );
  return parseVerdict(res.text, points);
}

/**
 * Classifies those of the given questions that have no verdict yet, at most
 * `limit` of them. Best-effort: a question whose call fails is left for the next
 * run. Returns how many verdicts were written.
 */
export async function classifyQuestions(
  questionIds: string[],
  { limit = MAX_PER_RUN, log = () => {} }: { limit?: number; log?: (msg: string) => void } = {},
): Promise<number> {
  if (!isDatabaseConfigured || questionIds.length === 0) return 0;
  // Without a model configured there is nothing to do; this is a background task,
  // so it stays quiet instead of failing the request that scheduled it.
  const config = await loadAIConfig().catch(() => null);
  if (!config) return 0;

  const db = getDb();
  const unique = [...new Set(questionIds)];
  const done = await db
    .select({ questionId: questionKnowledge.questionId })
    .from(questionKnowledge)
    .where(inArray(questionKnowledge.questionId, unique));
  const pending = unique.filter((id) => !done.some((d) => d.questionId === id)).slice(0, limit);
  if (pending.length === 0) return 0;

  let written = 0;
  for (const questionId of pending) {
    try {
      const verdict = await classifyQuestion(questionId);
      if (!verdict) continue;
      const row = {
        questionId,
        knowledgePointId: verdict.id,
        reason: verdict.reason,
        model: config.chatModel,
        createdAt: new Date(),
      };
      await db.insert(questionKnowledge).values(row).onConflictDoUpdate({ target: questionKnowledge.questionId, set: row });
      written++;
      log(`${questionId} → ${verdict.id ?? "未归类"}`);
    } catch (err) {
      // A missing syllabus or an unreachable model shouldn't abort the rest.
      console.error(`知识点判定失败 ${questionId}:`, err);
    }
  }
  return written;
}
