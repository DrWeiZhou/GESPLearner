import { revalidateTag } from "next/cache";
import { z } from "zod";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { restoreBackup, restoreFromList } from "@/lib/backup";

const MAX_BYTES = 512 * 1024 * 1024;

/**
 * Admin only: replace the database with a backup — either one listed in the data
 * folder (`{ name }` as JSON) or an uploaded file (the raw bytes as the body).
 * Everyone is signed out afterwards: the sessions are whatever the backup held.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    if (req.headers.get("content-type")?.includes("application/json")) {
      const { name } = z.object({ name: z.string().max(100) }).parse(await req.json());
      await restoreFromList(name);
    } else {
      const data = new Uint8Array(await req.arrayBuffer());
      if (data.length === 0) throw new HttpError(400, "请选择备份文件");
      if (data.length > MAX_BYTES) throw new HttpError(400, "备份文件过大");
      await restoreBackup(data);
    }
    revalidateTag("papers", { expire: 0 });
    revalidateTag("syllabus", { expire: 0 });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
