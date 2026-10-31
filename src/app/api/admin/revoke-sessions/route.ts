import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { revokeSessions } from "@/lib/admin";

const Body = z.object({ userId: z.string().uuid() });

/** Admin only: sign a user out of every device without changing their password. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { userId } = Body.parse(await req.json());
    await revokeSessions(userId);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
