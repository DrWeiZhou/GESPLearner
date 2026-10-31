import { revalidateTag } from "next/cache";
import { z } from "zod";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { importSyllabusLevel } from "@/lib/syllabus/sync";

// Rendering the level's pages and one vision-model call takes ~30–90 seconds.
export const maxDuration = 300;

const Body = z.object({ level: z.number().int().min(1).max(8) });

/**
 * Admin only: parse and import ONE level of the syllabus. The client walks the
 * levels one request at a time, so each level gets its own function time budget.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { level } = Body.parse(await req.json());

    let result;
    try {
      result = await importSyllabusLevel(level);
    } catch (err) {
      console.error(err);
      const message = (err instanceof Error ? err.message : String(err)).split("\n")[0];
      throw new HttpError(502, `解析失败：${message.slice(0, 300)}`);
    }
    revalidateTag("syllabus", { expire: 0 });
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
