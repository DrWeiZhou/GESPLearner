import { connection } from "next/server";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { checkForUpdates } from "@/lib/papers/sync";

export const maxDuration = 60;

/** Admin only: every C++ paper on the official site, with whether it's already in the library. */
export async function GET() {
  // Per-request: without this the build tries to prerender the handler (see app/admin/page.tsx).
  await connection();
  try {
    await requireAdmin();
    return Response.json(await checkForUpdates());
  } catch (err) {
    return errorResponse(err);
  }
}
