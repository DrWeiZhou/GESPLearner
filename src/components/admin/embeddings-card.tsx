"use client";

import { useState } from "react";
import { Loader2Icon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { postJSON } from "@/lib/api";

type EmbedProgress = { total: number; embedded: number; remaining: number };

/**
 * 「相似题向量」: the in-app version of `bun run embed`. Vectors drive the similar
 * questions shown to the AI tutor; one request embeds a batch, and the card keeps
 * asking until every question has one.
 */
export function EmbeddingsCard({ initial }: { initial: EmbedProgress }) {
  const [progress, setProgress] = useState(initial);
  const [busy, setBusy] = useState(false);

  const run = async (reset: boolean) => {
    setBusy(true);
    try {
      let p = await postJSON<EmbedProgress>("/api/admin/embeddings", { reset });
      setProgress(p);
      while (p.remaining > 0) {
        const before = p.remaining;
        p = await postJSON<EmbedProgress>("/api/admin/embeddings", {});
        setProgress(p);
        if (p.remaining >= before) throw new Error("向量生成没有进展，请检查向量模型设置");
      }
      toast.success(`已为全部 ${p.total} 道题生成向量`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  const percent = progress.total ? Math.round((progress.embedded / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">相似题向量</CardTitle>
        <CardDescription>
          用「大模型设置」中的向量模型为每道题生成向量，AI 讲解时会参考相似的真题。需要联网，约 3000 道题要几分钟。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span>
              已生成 {progress.embedded} / {progress.total} 道题
            </span>
            <span className="tabular-nums text-muted-foreground">{percent}%</span>
          </div>
          <Progress value={percent} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run(false)} disabled={busy || progress.remaining === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            {progress.embedded === 0 ? "生成题目向量" : "补全缺少的向量"}
          </Button>
          {progress.embedded > 0 && (
            <Button variant="outline" onClick={() => run(true)} disabled={busy}>
              <RefreshCwIcon /> 全部重新生成
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
