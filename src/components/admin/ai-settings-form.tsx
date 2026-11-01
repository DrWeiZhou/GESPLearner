"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, PlugZapIcon, SaveIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postJSON } from "@/lib/api";
import type { AISettingsView } from "@/lib/ai/settings";

const SOURCE_LABEL: Record<AISettingsView["source"], string> = {
  database: "后台配置",
  env: "环境变量",
  file: "本地配置文件",
  none: "未配置",
};

type Busy = "save" | "test" | "clear" | null;

export function AISettingsForm({ settings }: { settings: AISettingsView }) {
  const router = useRouter();
  const [form, setForm] = useState({
    baseUrl: settings.baseUrl,
    apiKey: "",
    chatModel: settings.chatModel,
    visionModel: settings.visionModel,
    embeddingModel: settings.embeddingModel,
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

  const valid = () => {
    if (!/^https?:\/\/\S+$/.test(form.baseUrl.trim())) return toast.error("请填写以 http(s):// 开头的接口地址"), false;
    if (![form.chatModel, form.visionModel, form.embeddingModel].every((m) => /^\S+$/.test(m.trim())))
      return toast.error("模型名不能为空或包含空格"), false;
    return true;
  };

  const test = () =>
    valid() &&
    run("test", async () => {
      const r = await postJSON<{ latencyMs: number; reply: string }>("/api/settings/ai/test", {
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        chatModel: form.chatModel,
      });
      toast.success(`连接成功（${r.latencyMs} ms）：模型回复「${r.reply || "（空）"}」`);
    });

  const save = () =>
    valid() &&
    run("save", async () => {
      await postJSON("/api/settings/ai", { ...form, apiKey: form.apiKey || undefined });
      setForm((f) => ({ ...f, apiKey: "" }));
      toast.success("已保存，立即生效");
      router.refresh();
    });

  const clear = () =>
    run("clear", async () => {
      const res = await fetch("/api/settings/ai", { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
      toast.success("已清除后台配置，改用环境变量");
      router.refresh();
    });

  const keyPlaceholder = settings.apiKeyHint
    ? `当前 ••••${settings.apiKeyHint}，留空则不修改`
    : "sk-… / 智谱 API key";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          大模型设置
          <Badge variant={settings.source === "none" ? "destructive" : "secondary"}>
            当前：{SOURCE_LABEL[settings.source]}
          </Badge>
        </CardTitle>
        <CardDescription>
          任意 OpenAI 兼容接口（如智谱、SiliconFlow、DeepSeek），用于 AI 讲解、错题知识点归类、试卷解析与相似题向量。
          API key 加密保存在本机，保存后只显示末 4 位。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{settings.error}</AlertDescription>
          </Alert>
        )}
        {settings.saveBlockedReason && (
          <Alert>
            <TriangleAlertIcon />
            <AlertDescription>
              {settings.saveBlockedReason}。可以先「测试连接」，配置好后再保存。
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-base-url">接口地址</Label>
            <Input
              id="ai-base-url"
              value={form.baseUrl}
              onChange={set("baseUrl")}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-key">API key</Label>
            <Input
              id="ai-key"
              type="password"
              value={form.apiKey}
              onChange={set("apiKey")}
              placeholder={keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-chat">讲解模型</Label>
            <Input id="ai-chat" value={form.chatModel} onChange={set("chatModel")} spellCheck={false} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-vision">视觉模型（解析试卷）</Label>
            <Input id="ai-vision" value={form.visionModel} onChange={set("visionModel")} spellCheck={false} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ai-embedding">向量模型</Label>
            <Input id="ai-embedding" value={form.embeddingModel} onChange={set("embeddingModel")} spellCheck={false} />
            <p className="text-xs text-muted-foreground">
              需支持 1024 维输出；更换后请在下方「相似题向量」中全部重新生成。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={test} disabled={busy !== null}>
            {busy === "test" ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
            测试连接
          </Button>
          <Button onClick={save} disabled={busy !== null || settings.saveBlockedReason !== null}>
            {busy === "save" ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            保存
          </Button>
          {settings.source === "database" && (
            <Button variant="ghost" onClick={clear} disabled={busy !== null} className="ml-auto text-muted-foreground">
              {busy === "clear" ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              清除后台配置
            </Button>
          )}
        </div>
        {settings.updatedAt && (
          <p className="text-xs text-muted-foreground">
            上次保存：{new Date(settings.updatedAt).toLocaleString("zh-CN")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
