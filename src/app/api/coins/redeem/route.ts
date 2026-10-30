import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { redeemAttempt } from "@/lib/coins";

const Body = z.object({ attemptId: z.string().uuid() });

/** Convert one finished attempt into coins (once per attempt). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { attemptId } = Body.parse(await req.json());
    return Response.json(await redeemAttempt(user.id, attemptId));
  } catch (err) {
    return errorResponse(err);
  }
}
