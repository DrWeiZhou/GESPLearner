import { count } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { papers } from "@/db/schema";

/**
 * Readiness probe for the desktop shell, which shows its splash screen until this
 * answers. The first call opens the database — migrating it and importing the
 * bundled question bank if needed — so the first page the student sees is fast.
 */
export async function GET() {
  await connection();
  try {
    const [row] = await getDb().select({ n: count() }).from(papers);
    return Response.json({ ok: true, papers: row.n });
  } catch (err) {
    console.error(err);
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
