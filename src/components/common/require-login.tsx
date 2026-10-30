import Link from "next/link";
import { LockIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { accountsEnabled } from "@/lib/auth";

/** Shown instead of personal pages when signed out (or when running in demo mode). */
export function RequireLogin({ next }: { next: string }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-4 py-10 text-center">
        <LockIcon className="mx-auto size-8 text-muted-foreground" />
        {accountsEnabled ? (
          <>
            <p className="text-sm text-muted-foreground">登录后即可查看你的学习记录。</p>
            <Link href={`/login?next=${encodeURIComponent(next)}`} className={buttonVariants()}>
              去登录
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            当前为演示模式（未配置 Supabase 与数据库），做题记录不会被保存。
            <br />
            配置 <code className="rounded bg-muted px-1.5 py-0.5">.env.local</code> 后即可启用账号功能。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
