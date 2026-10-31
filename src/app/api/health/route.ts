import { count } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { papers } from "@/db/schema";
import { findCompiler } from "@/lib/judge/compiler";

/**
 * Readiness probe for the desktop shell, which shows its splash screen until this
 * answers. The first call opens the database — migrating it and importing the
 * bundled question bank if needed — so the first page the student sees is fast.
 * It also starts compiler detection in the background.
 */
export async function GET() {
  await connection();
  try {
    const [row] = await getDb().select({ n: count() }).from(papers);
    // Detect the compiler in the background (cached), so on Windows the bundled
    // toolchain's ASCII mirror is ready before the first 运行 (see lib/judge/compiler).
    void findCompiler().catch(() => {});
    return Response.json({ ok: true, papers: row.n });
  } catch (err) {
    console.error(err);
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
