"use client";

import { useState } from "react";
import { CheckCircle2Icon, CloudDownloadIcon, ExternalLinkIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { postJSON } from "@/lib/api";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import type { SyllabusCheck, SyllabusImportResult, SyllabusStatus } from "@/lib/syllabus/sync";

type Job = { state: "queued" | "running" } | { state: "done"; points: number } | { state: "error"; message: string };

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

/**
 * 「更新考试大纲」: read the official 认证大纲 PDF and turn each C++ level into a list
 * of knowledge points. One request per level, so each gets its own time budget.
 */
export function SyllabusUpdateCard({ imported }: { imported: { level: number; points: number }[] }) {
  const [check, setCheck] = useState<SyllabusCheck | null>(null);
  const [jobs, setJobs] = useState<Record<number, Job>>({});
  const [busy, setBusy] = useState<"check" | "import" | null>(null);

  const runCheck = async () => {
    setBusy("check");
    try {
      const result = await getJSON<SyllabusCheck>("/api/admin/syllabus/updates");
      setCheck(result);
      setJobs({});
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "检查失败");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (levels: number[]) => {
    if (levels.length === 0) return;
    setBusy("import");
    setJobs((j) => ({ ...j, ...Object.fromEntries(levels.map((l) => [l, { state: "queued" } as Job])) }));

    let ok = 0;
    let failed = 0;
    for (const level of levels) {
      setJobs((j) => ({ ...j, [level]: { state: "running" } }));
      try {
        const result = await postJSON<SyllabusImportResult>("/api/admin/syllabus/import", { level });
        setJobs((j) => ({ ...j, [level]: { state: "done", points: result.points } }));
        setCheck((c) =>
          c && { ...c, levels: c.levels.map((l) => (l.level === level ? { ...l, points: result.points } : l)) },
        );
        ok++;
      } catch (err) {
        setJobs((j) => ({ ...j, [level]: { state: "error", message: err instanceof Error ? err.message : "解析失败" } }));
        failed++;
      }
    }
    setBusy(null);
    const summary = [ok && `${ok} 个级别已更新`, failed && `${failed} 个失败`].filter(Boolean).join("，");
    if (summary) (failed ? toast.error : toast.success)(`大纲导入完成：${summary}`);
  };

  const oneClick = async () => {
    const result = await runCheck();
    if (!result) return;
    await runImport(result.levels.map((l) => l.level));
  };

  const levels: SyllabusStatus[] =
    check?.levels ??
    imported.map((i) => ({ level: i.level, pages: [0, 0], points: i.points, updatedAt: null }));
  const errors = Object.entries(jobs).flatMap(([l, j]) => (j.state === "error" ? [{ level: l, message: j.message }] : []));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">考试大纲</CardTitle>
        <CardDescription>
          下载 GESP 官网「认证大纲」PDF，用大模型把每个 C++ 级别整理成知识点清单。错题本按这些知识点归类，
          学生做错一道题时会自动判定它属于哪个知识点。每个级别约需 10~30 秒，请保持页面打开。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={oneClick} disabled={busy !== null}>
            {busy !== null ? <Loader2Icon className="animate-spin" /> : <CloudDownloadIcon />}
            重新解析全部级别
          </Button>
          <Button variant="outline" onClick={runCheck} disabled={busy !== null}>
            {busy === "check" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            只检查
          </Button>
          {check?.source && (
            <a
              href={check.source.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              官方大纲 PDF <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>

        {levels.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有导入考试大纲，点「重新解析全部级别」开始。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {levels.map((l) => {
              const job = jobs[l.level];
              return (
                <button
                  key={l.level}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => runImport([l.level])}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                    "hover:border-primary/50 hover:bg-muted/40 disabled:opacity-60",
                    job?.state === "error" && "border-destructive/50 text-destructive",
                  )}
                  title={l.pages[1] ? `大纲 PDF 第 ${l.pages[0]}~${l.pages[1]} 页` : undefined}
                >
                  {job?.state === "running" || job?.state === "queued" ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : l.points > 0 ? (
                    <CheckCircle2Icon className="size-3 text-emerald-600" />
                  ) : null}
                  {LEVEL_NAMES[l.level]}
                  <span className="text-muted-foreground">
                    {job?.state === "done" ? `${job.points} 点` : l.points > 0 ? `${l.points} 点` : "未导入"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {errors.length > 0 && (
          <ul className="space-y-1 text-xs text-destructive">
            {errors.map((e) => (
              <li key={e.level}>
                {LEVEL_NAMES[Number(e.level)]}：{e.message}
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          重新解析会覆盖该级别的知识点。被删掉的知识点上原有的错题判定会一并清除，这些题目下次做错时会重新判定。
        </p>
      </CardContent>
    </Card>
  );
}
