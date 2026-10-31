import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { papers } from "@/db/schema";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { examTitleOf, OFFICIAL_BASE } from "@/lib/papers/official";
import { importPaper } from "@/lib/papers/sync";
import { paperId } from "@/lib/schema/paper";

// Rendering ~12 pages and one vision-model call usually takes 1–3 minutes.
export const maxDuration = 300;

const officialUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith(`${OFFICIAL_BASE}/`), "只能导入 GESP 官网的试卷");

const Body = z
  .object({
    examId: z.string().regex(/^\d{4}-\d{2}$/),
    level: z.number().int().min(1).max(8),
    pdfUrl: officialUrl,
    sourceUrl: officialUrl,
    publish: z.boolean(),
  })
  .transform((b) => ({ ...b, id: paperId(b.examId, b.level), examTitle: examTitleOf(b.examId) }));

/**
 * Admin only: download, parse and import ONE paper. The client walks the list
 * one request at a time, so each paper gets its own function time budget.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { publish, ...source } = Body.parse(await req.json());

    const [existing] = await getDb().select({ status: papers.status }).from(papers).where(eq(papers.id, source.id));
    // A published paper may have been corrected by hand — never overwrite it from here.
    if (existing?.status === "published") throw new HttpError(409, "该试卷已发布，无需重复导入");

    let result;
    try {
      result = await importPaper(source, { publish });
    } catch (err) {
      console.error(err);
      const message = (err instanceof Error ? err.message : String(err)).split("\n")[0];
      throw new HttpError(502, `解析失败：${message.slice(0, 300)}`);
    }
    if (result.status === "published") revalidateTag("papers", { expire: 0 });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
