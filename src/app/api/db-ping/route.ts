import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** Temporary diagnostic: times a trivial query so connection reuse can be observed. */
export async function GET() {
  const started = Date.now();
  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("query exceeded 12s")), 12_000),
    );
    const [row] = await Promise.race([
      getDb().execute(sql`select 1 as ok, inet_server_addr()::text as server`),
      timeout,
    ]);
    return Response.json({ ok: true, ms: Date.now() - started, row });
  } catch (err) {
    return Response.json(
      { ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
