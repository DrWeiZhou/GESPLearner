"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2Icon, Loader2Icon, PlayIcon, SaveIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { postJSON } from "@/lib/api";
import type { JudgeProvider, JudgeSettingsView } from "@/lib/judge/settings";

const SOURCE_LABEL: Record<JudgeSettingsView["source"], string> = {
  database: "后台配置",
  env: "环境变量",
  default: "自动检测",
};

const COMPILER_SOURCE: Record<NonNullable<JudgeSettingsView["compiler"]>["source"], string> = {
  settings: "手动指定",
  env: "环境变量 CXX",
  bundled: "程序自带",
  system: "本机已安装",
};

type Busy = "save" | "test" | "clear" | null;

export function JudgeSettingsForm({ settings }: { settings: JudgeSettingsView }) {
  const router = useRouter();
  const [form, setForm] = useState({
    provider: settings.provider as JudgeProvider,
    compilerPath: settings.compilerPath,
    judge0Url: settings.judge0Url,
    judge0Key: "",
  });
  const [busy, setBusy] = useState<Busy>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const body = () => ({
    provider: form.provider,
    compilerPath: form.compilerPath,
    judge0Url: form.judge0Url.trim(),
    judge0Key: form.judge0Key || undefined,
  });

  const test = () =>
    run("test", async () => {
      const r = await postJSON<{ elapsedMs: number }>("/api/settings/judge/test", body());
      toast.success(`测试通过：编译并运行 a+b 程序用时 ${(r.elapsedMs / 1000).toFixed(1)} 秒`);
    });

  const save = () =>
    run("save", async () => {
      await postJSON("/api/settings/judge", body());
      setForm((f) => ({ ...f, judge0Key: "" }));
      toast.success("已保存，立即生效");
      router.refresh();
    });

  const clear = () =>
    run("clear", async () => {
      const res = await fetch("/api/settings/judge", { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
      setForm((f) => ({ ...f, provider: "local", compilerPath: "" }));
      toast.success("已恢复为自动检测本机编译器");
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          代码评测
          <Badge variant="secondary">当前：{SOURCE_LABEL[settings.source]}</Badge>
        </CardTitle>
        <CardDescription>
          编程题的「运行」与「提交」在哪里编译执行。默认使用本机的 C++ 编译器（Windows 安装包已自带 GCC）；
          也可以改用 Judge0 评测服务。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.provider === "local" &&
          (settings.compiler ? (
            <Alert>
              <CheckCircle2Icon />
              <AlertDescription>
                <span>
                  正在使用 <span className="font-medium text-foreground">{settings.compiler.version}</span>（
                  {COMPILER_SOURCE[settings.compiler.source]}）
                </span>
                <code className="block break-all text-xs">{settings.compiler.path}</code>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{settings.compilerHint}</AlertDescription>
            </Alert>
          ))}

        <RadioGroup
          value={form.provider}
          onValueChange={(v) => setForm((f) => ({ ...f, provider: v as JudgeProvider }))}
          className="grid gap-2 sm:grid-cols-2"
        >
          {(
            [
              ["local", "本机编译器", "离线可用，无需任何配置"],
              ["judge0", "Judge0 评测服务", "自建或 RapidAPI 上的 Judge0"],
            ] as const
          ).map(([value, title, hint]) => (
            <Label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-data-checked:border-primary"
            >
              <RadioGroupItem value={value} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>

        {form.provider === "local" ? (
          <div className="space-y-1.5">
            <Label htmlFor="judge-cxx">编译器路径（可选）</Label>
            <Input
              id="judge-cxx"
              value={form.compilerPath}
              onChange={set("compilerPath")}
              placeholder="留空则自动检测，例如 C:\msys64\ucrt64\bin\g++.exe 或 /opt/homebrew/bin/g++-15"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="judge0-url">Judge0 地址</Label>
              <Input
                id="judge0-url"
                value={form.judge0Url}
                onChange={set("judge0Url")}
                placeholder="http://localhost:2358 或 https://judge0-ce.p.rapidapi.com"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="judge0-key">密钥（可选）</Label>
              <Input
                id="judge0-key"
                type="password"
                value={form.judge0Key}
                onChange={set("judge0Key")}
                placeholder={
                  settings.judge0KeyHint
                    ? `当前 ••••${settings.judge0KeyHint}，留空则不修改`
                    : "RapidAPI key 或 X-Auth-Token"
                }
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={test} disabled={busy !== null}>
            {busy === "test" ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
            测试
          </Button>
          <Button onClick={save} disabled={busy !== null}>
            {busy === "save" ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            保存
          </Button>
          {settings.source === "database" && (
            <Button variant="ghost" onClick={clear} disabled={busy !== null} className="ml-auto text-muted-foreground">
              {busy === "clear" ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              恢复自动检测
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
