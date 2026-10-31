import { readFile } from "node:fs/promises";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { backupPath } from "@/lib/backup";

/** Admin only: download one backup (the desktop shell asks where to save it). */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/backup/[name]">) {
  try {
    await requireAdmin();
    const { name } = await ctx.params;
    const data = await readFile(backupPath(name));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(data.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
