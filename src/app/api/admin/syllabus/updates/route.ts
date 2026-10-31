import { connection } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { checkSyllabus } from "@/lib/syllabus/sync";

export const maxDuration = 60;

/** Admin only: the official syllabus PDF, its levels, and what's already imported. */
export async function GET() {
  // Per-request: without this the build tries to prerender the handler (see app/admin/page.tsx).
  await connection();
  try {
    await requireAdmin();
    return Response.json(await checkSyllabus());
  } catch (err) {
    return errorResponse(err);
  }
}
