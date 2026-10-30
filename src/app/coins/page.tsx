import type { Metadata } from "next";
import { Suspense } from "react";
import { CoinWallet } from "@/components/coins/coin-wallet";
import { RequireLogin } from "@/components/common/require-login";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { getBalance, getCoinRate, getLedger, getRedeemableAttempts } from "@/lib/coins";
import { connection } from "next/server";

export const metadata: Metadata = { title: "我的金币" };

export default function CoinsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">我的金币</h1>
      <p className="mb-6 text-sm text-muted-foreground">每做完一份试卷，可以把得分兑换成金币（每份限一次）。</p>
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

  const [balance, rate, redeemable, ledger] = await Promise.all([
    getBalance(user.id),
    getCoinRate(),
    getRedeemableAttempts(user.id),
    getLedger(user.id),
  ]);
  return <CoinWallet balance={balance} rate={rate} redeemable={redeemable} ledger={ledger} />;
}
