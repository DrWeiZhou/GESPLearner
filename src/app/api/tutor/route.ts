import { toUIMessageStream } from "@ai-sdk/langchain";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { z } from "zod";
import { errorResponse, HttpError, requireUserIfConfigured } from "@/lib/auth";
import { getAnswerKeys, getQuestion, getSimilarQuestions } from "@/lib/content";
import { getChatModel } from "@/lib/ai/model";
import { buildObjectiveMessages, buildProgrammingMessages, relatedQuestionsBlock } from "@/lib/ai/prompts";
import { saveChat } from "@/lib/records";
import type { JudgeResult } from "@/lib/types";

export const maxDuration = 60;

const Body = z.object({
  questionId: z.string(),
  context: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("objective"), answer: z.string().nullable() }),
    z.object({
      kind: z.literal("programming"),
      code: z.string().max(64 * 1024),
      judge: z.custom<JudgeResult>().nullish(),
    }),
  ]),
  /** useChat UI messages. The first user message is just the "讲解" trigger. */
  messages: z.array(z.custom<UIMessage>()).min(1).max(40),
});

const textOf = (m: UIMessage) =>
  m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .slice(0, 8000);

/**
 * AI tutor: LangChain chat model → @ai-sdk/langchain adapter → AI SDK UI message stream
 * (consumed by `useChat` on the client).
 *
 * The answer key / reference solution are looked up here and only go into the system
 * prompt; the client only supplies the student's own work.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUserIfConfigured();
    const { questionId, context, messages } = Body.parse(await req.json());

    const found = await getQuestion(questionId);
    if (!found) throw new HttpError(404, "题目不存在");
    const { paper, question } = found;
    const [keys, related] = await Promise.all([getAnswerKeys([questionId]), getSimilarQuestions(questionId, 3)]);
    const key = keys.get(questionId) ?? { answer: null, explanation: null, referenceSolution: null };

    let base;
    if (question.type === "programming") {
      if (context.kind !== "programming") throw new HttpError(400, "参数错误");
      base = buildProgrammingMessages({ paper, question, key, code: context.code, judge: context.judge });
    } else {
      if (context.kind !== "objective") throw new HttpError(400, "参数错误");
      base = buildObjectiveMessages({ paper, question, key, studentAnswer: context.answer });
    }
    const [system, task] = base;

    const history: BaseMessage[] = messages
      .slice(1)
      .map((m) => (m.role === "assistant" ? new AIMessage(textOf(m)) : new HumanMessage(textOf(m))));
    const lcMessages = [
      new SystemMessage(system.content + relatedQuestionsBlock(related)),
      new HumanMessage(task.content),
      ...history,
    ];

    const stream = await (await getChatModel()).stream(lcMessages);

    return createUIMessageStreamResponse({
      stream: toUIMessageStream(stream, {
        onFinal: async (completion) => {
          if (!user || !completion) return;
          const stored = [
            ...messages.map((m) => ({ id: m.id, role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), text: textOf(m) })),
            { id: crypto.randomUUID(), role: "assistant" as const, text: completion },
          ];
          await saveChat(user.id, questionId, stored).catch((e) => console.error("saveChat", e));
        },
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
