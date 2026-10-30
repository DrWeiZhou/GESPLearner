"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "./actions";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [state, action, pending] = useActionState(mode === "login" ? signIn : signUp, undefined);
  const isLogin = mode === "login";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{isLogin ? "登录" : "注册账号"}</CardTitle>
        <CardDescription>
          {isLogin ? "登录后可保存做题记录、错题本和金币" : "用用户名和密码即可注册，无需邮箱"}
        </CardDescription>
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4">
          {next && <input type="hidden" name="next" value={next} />}
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              placeholder="3~20 位字母、数字、下划线"
              required
              autoFocus
            />
          </div>
          {!isLogin && (
            <div className="space-y-2">
              <Label htmlFor="displayName">昵称（可选）</Label>
              <Input id="displayName" name="displayName" placeholder="不填则使用用户名" maxLength={20} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </div>
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            {isLogin ? "登录" : "注册"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {isLogin ? "还没有账号？" : "已有账号？"}
            <Link href={isLogin ? "/signup" : "/login"} className="ml-1 text-primary underline-offset-4 hover:underline">
              {isLogin ? "立即注册" : "去登录"}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
