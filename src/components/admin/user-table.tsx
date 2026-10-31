"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRoundIcon, Loader2Icon, LockIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postJSON } from "@/lib/api";
import type { ManagedUser } from "@/lib/admin";

/** Readable for a child to type: no 0/O/1/l/I to confuse. */
function suggestPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function UserTable({ users, currentUserId }: { users: ManagedUser[]; currentUserId: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [done, setDone] = useState<{ username: string; password: string } | null>(null);

  const openReset = (u: ManagedUser) => {
    setTarget(u);
    setNewPassword(suggestPassword());
    setAdminPassword("");
    setDone(null);
  };

  const submitReset = async () => {
    if (!target) return;
    setPending("reset");
    try {
      await postJSON("/api/admin/reset-password", {
        userId: target.id,
        newPassword,
        adminPassword,
      });
      setDone({ username: target.username, password: newPassword });
      setAdminPassword("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重置失败");
    } finally {
      setPending(null);
    }
  };

  const revoke = async (u: ManagedUser) => {
    setPending(u.id);
    try {
      await postJSON("/api/admin/revoke-sessions", { userId: u.id });
      toast.success(`已让 ${u.displayName} 在所有设备上退出登录`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">用户管理</CardTitle>
          <CardDescription>
            学生没有邮箱，忘记密码只能由管理员在这里重置。共 {users.length} 个账号。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {users.map((u) => {
              const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-sm">
                  <span className="font-medium">{u.displayName}</span>
                  <span className="text-muted-foreground">@{u.username}</span>
                  {u.role === "admin" && <Badge variant="outline">管理员</Badge>}
                  {u.id === currentUserId && <Badge variant="secondary">当前账号</Badge>}
                  {locked && (
                    <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      <LockIcon className="size-3" /> 已锁定
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {u.coins} 金币 · {u.activeSessions} 处登录 ·{" "}
                    {u.lastLoginAt
                      ? `最近登录 ${new Date(u.lastLoginAt).toLocaleDateString("zh-CN")}`
                      : "从未登录"}
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending !== null || u.activeSessions === 0}
                      onClick={() => revoke(u)}
                    >
                      {pending === u.id ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
                      强制退出
                    </Button>
                    <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => openReset(u)}>
                      <KeyRoundIcon /> 重置密码
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置 {target?.displayName} 的密码</DialogTitle>
            <DialogDescription>
              重置后该账号在所有设备上的登录都会失效，登录锁定也会一并解除。
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <Alert>
              <AlertDescription className="space-y-2">
                <div>
                  <b>{done.username}</b> 的新密码已生效，请立即转告并妥善保存——此窗口关闭后无法再次查看：
                </div>
                <code className="block rounded-md bg-muted px-3 py-2 font-mono text-base select-all">
                  {done.password}
                </code>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">新密码</Label>
                <div className="flex gap-2">
                  <Input
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="font-mono"
                    minLength={6}
                  />
                  <Button variant="outline" size="icon" title="随机生成" onClick={() => setNewPassword(suggestPassword())}>
                    <RefreshCwIcon />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminPassword">你的管理员密码</Label>
                <Input
                  id="adminPassword"
                  type="password"
                  autoComplete="current-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="用于确认本人操作"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {done ? (
              <DialogClose render={<Button />}>完成</DialogClose>
            ) : (
              <>
                <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
                <Button
                  disabled={pending !== null || newPassword.length < 6 || adminPassword.length === 0}
                  onClick={submitReset}
                >
                  {pending === "reset" && <Loader2Icon className="animate-spin" />}
                  确认重置
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
