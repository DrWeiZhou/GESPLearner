import { revalidateTag } from "next/cache";
import { count, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { questions } from "@/db/schema";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { embedQuestions } from "@/lib/papers/seed";

const Body = z.object({
  /** Drop every vector first, e.g. after switching the embedding model. */
  reset: z.boolean().default(false),
  limit: z.number().int().min(1).max(256).default(64),
});

async function progress() {
  const db = getDb();
  const [all] = await db.select({ n: count() }).from(questions);
  const [done] = await db.select({ n: count() }).from(questions).where(isNotNull(questions.embedding));
  return { total: all.n, embedded: done.n, remaining: all.n - done.n };
}

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await progress());
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Admin only: embed the next `limit` questions that have no vector yet (what
 * `bun run embed` does, in steps). The page calls it until nothing remains, so a
 * long run shows progress and survives a slow model.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { reset, limit } = Body.parse(await req.json().catch(() => ({})));
    if (reset) getDb().update(questions).set({ embedding: null }).run();
    try {
      await embedQuestions({ limit });
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).split("\n")[0];
      throw new HttpError(502, `生成失败：${message.slice(0, 300)}`);
    }
    const p = await progress();
    // Similar-question lists (cached for days) were computed without these vectors.
    if (p.remaining === 0 || reset) revalidateTag("papers", { expire: 0 });
    return Response.json(p);
  } catch (err) {
    return errorResponse(err);
  }
}
