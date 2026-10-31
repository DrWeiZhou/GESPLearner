import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PasswordForm } from "@/components/account/password-form";
import { RequireLogin } from "@/components/common/require-login";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "账号设置" };

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">账号设置</h1>
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <Account />
      </Suspense>
    </div>
  );
}

async function Account() {
  // Per-request read — see the note in app/coins/page.tsx.
  await connection();
  const user = await getCurrentUser();
  if (!user) return <RequireLogin next="/account" />;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-5 text-sm">
          <div className="flex gap-3">
            <span className="w-16 text-muted-foreground">用户名</span>
            <span className="font-medium">{user.username}</span>
          </div>
          <div className="mt-2 flex gap-3">
            <span className="w-16 text-muted-foreground">昵称</span>
            <span>{user.displayName}</span>
          </div>
          <div className="mt-2 flex gap-3">
            <span className="w-16 text-muted-foreground">角色</span>
            <span>{user.role === "admin" ? "管理员" : "学生"}</span>
          </div>
        </CardContent>
      </Card>
      <PasswordForm />
    </div>
  );
}
