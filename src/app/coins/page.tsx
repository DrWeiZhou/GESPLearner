import type { Metadata } from "next";
import { Suspense } from "react";
import { CoinWallet } from "@/components/coins/coin-wallet";
import { RequireLogin } from "@/components/common/require-login";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { getBalance, getCoinRate, getLedger } from "@/lib/coins";
import { connection } from "next/server";

export const metadata: Metadata = { title: "我的金币" };

export default function CoinsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">我的金币</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        每做对一道新题都会按得分发金币，一道题只发一次 —— 重做或在错题本里再做一遍都不再发放。
      </p>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Wallet />
      </Suspense>
    </div>
  );
}

async function Wallet() {
  // These reads are per-request and hit the database. Without this the prerender
  // pass tries to run them and trips on the driver's internal clock reads, leaving
  // the Suspense boundary unresolved until the function times out.
  await connection();
  const user = await getCurrentUser();

  if (!user) return <RequireLogin next="/coins" />;

  // Sequential on purpose: issuing these concurrently inside a Server Component
  // render leaves the Suspense boundary unresolved on Vercel. Each query is only a
  // few milliseconds now that the function sits in the same region as the database.
  const balance = await getBalance(user.id);
  const rate = await getCoinRate();
  const ledger = await getLedger(user.id);
  return <CoinWallet balance={balance} rate={rate} ledger={ledger} />;
}
