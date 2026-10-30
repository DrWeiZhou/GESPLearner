import type { Metadata } from "next";
import { Suspense } from "react";
import { CoinRateForm } from "@/components/admin/coin-rate-form";
import { RequireLogin } from "@/components/common/require-login";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { getCoinRate } from "@/lib/coins";

export const metadata: Metadata = { title: "系统设置" };

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">系统设置</h1>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  const user = await getCurrentUser();
  if (!user) return <RequireLogin next="/admin" />;
  if (user.role !== "admin") {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          需要管理员权限。系统中注册的第一个账号即为管理员。
        </CardContent>
      </Card>
    );
  }
  return <CoinRateForm rate={await getCoinRate()} />;
}
