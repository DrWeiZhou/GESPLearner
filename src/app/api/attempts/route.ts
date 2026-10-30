import { z } from "zod";
import { getDb } from "@/db";
import { attempts } from "@/db/schema";
import { errorResponse, HttpError, requireUserIfConfigured } from "@/lib/auth";
import { getPaper } from "@/lib/content";

const Body = z.object({ paperId: z.string(), mode: z.enum(["practice", "exam"]).default("exam") });

/** Starts a timed mock exam. Returns `id: null` in demo mode (nothing persisted). */
export async function POST(req: Request) {
  try {
    const user = await requireUserIfConfigured();
    const { paperId, mode } = Body.parse(await req.json());
    const paper = await getPaper(paperId);
    if (!paper) throw new HttpError(404, "试卷不存在");

    if (!user) return Response.json({ id: null, startedAt: new Date().toISOString() });

    const [row] = await getDb()
      .insert(attempts)
      .values({ userId: user.id, paperId, mode, maxScore: paper.totalScore })
      .returning({ id: attempts.id, startedAt: attempts.startedAt });
    return Response.json(row);
  } catch (err) {
    return errorResponse(err);
  }
}
