import { errorResponse, requireAdmin } from "@/lib/auth";
import { createBackup, listBackups } from "@/lib/backup";

/** Admin only: the backups in the data folder, newest first. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(listBackups());
  } catch (err) {
    return errorResponse(err);
  }
}

/** Admin only: back up now. */
export async function POST() {
  try {
    await requireAdmin();
    return Response.json(createBackup());
  } catch (err) {
    return errorResponse(err);
  }
}
