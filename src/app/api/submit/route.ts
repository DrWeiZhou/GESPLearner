import { z } from "zod";
import { errorResponse, HttpError, requireUserIfConfigured } from "@/lib/auth";
import { getQuestion, getTestCases } from "@/lib/content";
import { judge, MAX_CODE_LENGTH } from "@/lib/judge";
import { getOpenAttempt, recordSubmission } from "@/lib/records";

const Body = z.object({
  questionId: z.string(),
  code: z.string().min(1).max(MAX_CODE_LENGTH),
  attemptId: z.string().uuid().nullish(),
});

/** "提交" button: judge against samples + hidden tests and record the submission. */
export async function POST(req: Request) {
  try {
    const user = await requireUserIfConfigured();
    const { questionId, code, attemptId } = Body.parse(await req.json());

    const found = await getQuestion(questionId);
    if (!found || found.question.type !== "programming") throw new HttpError(404, "题目不存在");
    const q = found.question;

    const attempt = user && attemptId ? await getOpenAttempt(user.id, attemptId) : null;
    if (attemptId && user && !attempt) throw new HttpError(400, "考试已结束或不存在");

    const cases = await getTestCases(questionId);
    const result = await judge(code, cases, { timeLimitMs: q.timeLimitMs, memoryLimitMb: q.memoryLimitMb });
    result.score = result.total ? Math.round((q.score * result.passed) / result.total) : 0;

    if (user) await recordSubmission({ userId: user.id, questionId, code, result, attemptId: attempt?.id });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
