import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getBalance, getCoinRate, getLedger, getRedeemableAttempts } from "@/lib/coins";

/** Temporary diagnostic: times each query the wallet page runs. */
async function step<T>(name: string, fn: () => Promise<T>) {
  const t0 = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 10s")), 10_000)),
    ]);
    return { name, ms: Date.now() - t0, ok: true as const, value };
  } catch (err) {
    return { name, ms: Date.now() - t0, ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET() {
  const out: unknown[] = [];
  out.push(await step("ping", async () => (await getDb().execute(sql`select 1 as ok`))[0]));
  const user = await step("getCurrentUser", () => getCurrentUser());
  out.push({ ...user, value: user.ok ? (user.value ? { id: user.value.id, username: user.value.username } : null) : undefined });
  const uid = user.ok && user.value ? user.value.id : null;
  if (uid) {
    out.push(await step("getBalance", () => getBalance(uid)));
    out.push(await step("getCoinRate", () => getCoinRate()));
    out.push(await step("getRedeemable", async () => (await getRedeemableAttempts(uid)).length));
    out.push(await step("getLedger", async () => (await getLedger(uid)).length));
  }
  return Response.json(out);
}
