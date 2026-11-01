"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArchiveRestoreIcon, DatabaseBackupIcon, DownloadIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { postJSON } from "@/lib/api";
import type { BackupFile } from "@/lib/backup";

const size = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

const KIND: Record<string, string> = { auto: "自动", restore: "恢复前" };
const kindOf = (name: string) => KIND[/-([a-z]+)\.db$/.exec(name)?.[1] ?? ""] ?? "手动";

/**
 * 「数据备份」: accounts, answers and coins live only in this computer's database,
 * so the app backs it up daily and lets an admin download / restore copies.
 */
export function BackupCard({ initial, folder }: { initial: BackupFile[]; folder: string }) {
  const router = useRouter();
  const [backups, setBackups] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const backupNow = () =>
    run("create", async () => {
      const b = await postJSON<BackupFile>("/api/admin/backup", {});
      setBackups((list) => [b, ...list.filter((x) => x.name !== b.name)]);
      toast.success(`已备份：${b.name}`);
    });

  const restored = () => {
    // The restored database has its own sessions, so this one is gone.
    toast.success("已从备份恢复，请重新登录");
    router.push("/login?next=/admin");
    router.refresh();
  };

  const restoreListed = (name: string) => {
    if (!confirm(`用备份「${name}」覆盖当前全部数据？\n当前数据会先自动备份一份。`)) return;
    void run(name, async () => {
      await postJSON("/api/admin/backup/restore", { name });
      restored();
    });
  };

  const restoreUpload = (file: File) => {
    if (!confirm(`用文件「${file.name}」覆盖当前全部数据？\n当前数据会先自动备份一份。`)) return;
    void run("upload", async () => {
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
      restored();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">数据备份</CardTitle>
        <CardDescription>
          账号、作答记录、金币和 AI 对话都只保存在这台电脑上。程序每天首次启动时自动备份（保留最近 30 份），
          换电脑时把备份文件下载下来，在新电脑上「从文件恢复」即可。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={backupNow} disabled={busy !== null}>
            {busy === "create" ? <Loader2Icon className="animate-spin" /> : <DatabaseBackupIcon />}
            立即备份
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === "upload" ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            从文件恢复
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".db,application/vnd.sqlite3"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) restoreUpload(file);
            }}
          />
        </div>

        {backups.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="text-right">大小</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.slice(0, 10).map((b) => (
                <TableRow key={b.name}>
                  <TableCell className="tabular-nums">{new Date(b.createdAt).toLocaleString("zh-CN")}</TableCell>
                  <TableCell>{kindOf(b.name)}</TableCell>
                  <TableCell className="text-right tabular-nums">{size(b.size)}</TableCell>
                  <TableCell className="flex justify-end gap-1">
                    <a href={`/api/admin/backup/${b.name}`} download className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      <DownloadIcon /> 下载
                    </a>
                    <Button variant="ghost" size="sm" onClick={() => restoreListed(b.name)} disabled={busy !== null}>
                      {busy === b.name ? <Loader2Icon className="animate-spin" /> : <ArchiveRestoreIcon />}
                      恢复
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">还没有备份。</p>
        )}
        <p className="break-all text-xs text-muted-foreground">备份位置：{folder}</p>
      </CardContent>
    </Card>
  );
}
