import { z } from "zod";
import { errorResponse, HttpError, requireUserIfConfigured } from "@/lib/auth";
import { rewardQuestions } from "@/lib/coins";
import { getAnswerKeys, getQuestion } from "@/lib/content";
import { QUESTION_TYPE_LABEL } from "@/lib/format";
import { recordAnswer } from "@/lib/records";

const Body = z.object({
  questionId: z.string(),
  answer: z.enum(["A", "B", "C", "D", "T", "F"]),
});

/** Practice mode: grade one objective question immediately and reveal the key. */
export async function POST(req: Request) {
  try {
    const user = await requireUserIfConfigured();
    const { questionId, answer } = Body.parse(await req.json());

    const found = await getQuestion(questionId);
    if (!found || found.question.type === "programming") throw new HttpError(404, "题目不存在");
    const q = found.question;

    const key = (await getAnswerKeys([questionId])).get(questionId);
    if (!key?.answer) throw new HttpError(404, "该题暂无答案");

    const correct = key.answer === answer;
    let reward = null;
    if (user) {
      await recordAnswer({ userId: user.id, questionId, answer, isCorrect: correct });
      // Settled on the first grading only, so a redo — the usual case when the
      // question came from the wrong-answer book — earns nothing.
      reward = await rewardQuestions(user.id, [
        { questionId, score: correct ? q.score : 0, label: `${QUESTION_TYPE_LABEL[q.type]}第 ${q.number} 题` },
      ]);
    }

    return Response.json({ correct, answer: key.answer, explanation: key.explanation, reward });
  } catch (err) {
    return errorResponse(err);
  }
}
