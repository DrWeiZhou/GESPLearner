import { z } from "zod";
import { errorResponse, HttpError, requireUserIfConfigured } from "@/lib/auth";
import { getQuestion } from "@/lib/content";
import { MAX_CODE_LENGTH, MAX_STDIN_LENGTH, runCode } from "@/lib/judge";

const Body = z.object({
  questionId: z.string().optional(),
  code: z.string().min(1).max(MAX_CODE_LENGTH),
  stdin: z.string().max(MAX_STDIN_LENGTH).default(""),
});

/** "运行" button: compile and run with custom input, no grading. */
export async function POST(req: Request) {
  try {
    await requireUserIfConfigured();
    const { questionId, code, stdin } = Body.parse(await req.json());

    let limits = { timeLimitMs: 2000, memoryLimitMb: 256 };
    if (questionId) {
      const found = await getQuestion(questionId);
      if (!found) throw new HttpError(404, "题目不存在");
      if (found.question.type === "programming")
        limits = { timeLimitMs: found.question.timeLimitMs, memoryLimitMb: found.question.memoryLimitMb };
    }
    return Response.json(await runCode(code, stdin, limits));
  } catch (err) {
    return errorResponse(err);
  }
}
