"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2Icon,
  CloudDownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
  SquareIcon,
  TriangleAlertIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { postJSON } from "@/lib/api";
import type { ImportResult, OfficialExam, OfficialPaper, UpdateCheck } from "@/lib/papers/sync";
import { LEVEL_NAMES } from "@/lib/schema/paper";

type Job =
  | { state: "queued" | "running" }
  | { state: "done"; result: ImportResult }
  | { state: "error"; message: string };

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

/** What 一键更新 imports: every new exam's papers at the levels the library already covers. */
function defaultSelection(check: UpdateCheck) {
  const levels = new Set(check.libraryLevels);
  return check.exams
    .filter((e) => e.isNew)
    .flatMap((e) => e.papers)
    .filter((p) => p.status === "missing" && (levels.size === 0 || levels.has(p.level)))
    .map((p) => p.id);
}

export function PaperUpdateCard() {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef(false);

  // Elapsed-time display for the paper being parsed.
  useEffect(() => {
    if (runningSince === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runningSince]);

  const papers = check?.exams.flatMap((e) => e.papers) ?? [];
  const setJob = (id: string, job: Job) => setJobs((j) => ({ ...j, [id]: job }));

  const runCheck = async () => {
    setBusy("check");
    try {
      const result = await getJSON<UpdateCheck>("/api/admin/papers/updates");
      setCheck(result);
      setSelected(new Set(defaultSelection(result)));
      setJobs({});
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "检查失败");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (targets: OfficialPaper[]) => {
    if (targets.length === 0) return;
    setBusy("import");
    stopRef.current = false;
    setJobs((j) => ({ ...j, ...Object.fromEntries(targets.map((p) => [p.id, { state: "queued" } as Job])) }));

    let published = 0;
    let drafts = 0;
    let failed = 0;
    for (const p of targets) {
      if (stopRef.current) {
        setJobs((j) => {
          const next = { ...j };
          for (const t of targets) if (next[t.id]?.state === "queued") delete next[t.id];
          return next;
        });
        break;
      }
      setJob(p.id, { state: "running" });
      setRunningSince(Date.now());
      setNow(Date.now());
      try {
        const result = await postJSON<ImportResult>("/api/admin/papers/import", {
          examId: p.examId,
          level: p.level,
          pdfUrl: p.pdfUrl,
          sourceUrl: p.sourceUrl,
          publish,
        });
        setJob(p.id, { state: "done", result });
        if (result.status === "published") published++;
        else drafts++;
        // Reflect the new status locally instead of re-crawling the official site.
        setCheck((c) => c && markStatus(c, p.id, result.status));
        setSelected((s) => {
          const next = new Set(s);
          next.delete(p.id);
          return next;
        });
      } catch (err) {
        failed++;
        setJob(p.id, { state: "error", message: err instanceof Error ? err.message : "导入失败" });
      }
    }
    setRunningSince(null);
    setBusy(null);

    const parts = [published && `发布 ${published} 份`, drafts && `${drafts} 份存为草稿`, failed && `${failed} 份失败`];
    const summary = parts.filter(Boolean).join("，");
    if (summary) (failed ? toast.error : drafts ? toast.warning : toast.success)(`导入完成：${summary}`);
  };

  const oneClick = async () => {
    const result = await runCheck();
    if (!result) return;
    const ids = new Set(defaultSelection(result));
    if (ids.size === 0) return toast.success("没有新的考试，题库已是最新");
    await runImport(result.exams.flatMap((e) => e.papers).filter((p) => ids.has(p.id)));
  };

  const publishDraft = async (id: string) => {
    try {
      await postJSON("/api/admin/papers/publish", { paperId: id });
      setCheck((c) => c && markStatus(c, id, "published"));
      toast.success(`${id} 已发布`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "发布失败");
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const newExams = check?.exams.filter((e) => e.isNew) ?? [];
  const otherExams = check?.exams.filter((e) => !e.isNew && e.papers.some((p) => p.status === "missing")) ?? [];
  const otherMissing = otherExams.reduce((n, e) => n + e.papers.filter((p) => p.status === "missing").length, 0);
  const drafts = papers.filter((p) => p.status === "parsed");
  const selectedPapers = papers.filter((p) => selected.has(p.id));
  const errors = Object.entries(jobs).flatMap(([id, j]) => (j.state === "error" ? [{ id, message: j.message }] : []));

  const examRows = (list: OfficialExam[]) =>
    list.map((exam) => (
      <div key={exam.examId} className="flex flex-wrap items-center gap-2 py-1.5">
        <a
          href={exam.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="flex w-32 shrink-0 items-center gap-1 text-sm font-medium hover:underline"
        >
          {exam.examTitle.replace("GESP认证", "")}
          <ExternalLinkIcon className="size-3 text-muted-foreground" />
        </a>
        {exam.papers
          .filter((p) => p.status === "missing" || jobs[p.id])
          .map((p) => (
            <LevelChip
              key={p.id}
              paper={p}
              job={jobs[p.id]}
              selected={selected.has(p.id)}
              disabled={busy !== null}
              onToggle={() => toggle(p.id)}
            />
          ))}
      </div>
    ));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">更新题库</CardTitle>
        <CardDescription>
          检查 GESP 官网「真题及解析」是否有新的考试，下载 C++ 试卷 PDF，用视觉模型解析后导入题库。
          一键更新会导入比题库最新一场更新的考试，级别与题库已有的一致（题库为空时导入最新一场的全部级别）；每份约需 1~3 分钟，请保持页面打开。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={oneClick} disabled={busy !== null}>
            {busy !== null ? <Loader2Icon className="animate-spin" /> : <CloudDownloadIcon />}
            一键更新
          </Button>
          <Button variant="outline" onClick={runCheck} disabled={busy !== null}>
            {busy === "check" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            只检查
          </Button>
          {busy === "import" && (
            <Button variant="ghost" onClick={() => (stopRef.current = true)} className="text-muted-foreground">
              <SquareIcon />
              当前这份完成后停止
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Switch id="paper-publish" checked={publish} onCheckedChange={setPublish} disabled={busy !== null} />
            <Label htmlFor="paper-publish" className="text-sm font-normal">
              通过校验后直接发布
            </Label>
          </div>
        </div>

        {check && (
          <>
            <p className="text-sm text-muted-foreground">
              官网共 {check.exams.length} 场考试、{papers.length} 份 C++ 试卷；题库已发布{" "}
              {papers.filter((p) => p.status === "published").length} 份
              {check.libraryLevels.length > 0 && `（${check.libraryLevels.map((l) => LEVEL_NAMES[l]).join("、")}）`}。
              检查于 {new Date(check.checkedAt).toLocaleTimeString("zh-CN")}。
            </p>

            {newExams.length > 0 ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold">新考试</h3>
                {examRows(newExams)}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-sm">
                <CheckCircle2Icon className="size-4 text-emerald-600" />
                没有新的考试，题库已收录官网最新一场（{check.exams[0]?.examTitle ?? "—"}）。
              </p>
            )}

            {otherMissing > 0 && (
              <details className="rounded-lg border px-3 py-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  往期考试中还有 {otherMissing} 份试卷未收录
                </summary>
                <div className="mt-2">{examRows(otherExams)}</div>
              </details>
            )}

            {drafts.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">草稿（学生看不到）</h3>
                {drafts.map((p) => {
                  const job = jobs[p.id];
                  const warnings = job?.state === "done" ? job.result.warnings : [];
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <a href={p.pdfUrl} target="_blank" rel="noreferrer" className="hover:underline">
                        {p.examTitle.replace("GESP认证", "")} {LEVEL_NAMES[p.level]}
                      </a>
                      {warnings.length > 0 && (
                        <span className="text-xs text-amber-600">{warnings.join("；")}</span>
                      )}
                      <div className="ml-auto flex gap-1.5">
                        <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => runImport([p])}>
                          <RefreshCwIcon />
                          重新解析
                        </Button>
                        <Button size="xs" disabled={busy !== null} onClick={() => publishDraft(p.id)}>
                          <UploadIcon />
                          发布
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {errors.length > 0 && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>
                  {errors.map((e) => (
                    <div key={e.id}>
                      {e.id}：{e.message}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {(newExams.length > 0 || otherMissing > 0) && (
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  disabled={busy !== null || selectedPapers.length === 0}
                  onClick={() => runImport(selectedPapers)}
                >
                  <CloudDownloadIcon />
                  导入所选（{selectedPapers.length} 份）
                </Button>
                {runningSince !== null && (
                  <span className="text-xs text-muted-foreground">
                    正在解析，已用 {Math.round((now - runningSince) / 1000)} 秒
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function markStatus(check: UpdateCheck, id: string, status: OfficialPaper["status"]): UpdateCheck {
  return {
    ...check,
    exams: check.exams.map((e) => ({ ...e, papers: e.papers.map((p) => (p.id === id ? { ...p, status } : p)) })),
  };
}

function LevelChip({
  paper,
  job,
  selected,
  disabled,
  onToggle,
}: {
  paper: OfficialPaper;
  job: Job | undefined;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const icon =
    job?.state === "running" ? (
      <Loader2Icon className="animate-spin" />
    ) : job?.state === "done" ? (
      job.result.status === "published" ? (
        <CheckCircle2Icon className="text-emerald-600" />
      ) : (
        <TriangleAlertIcon className="text-amber-600" />
      )
    ) : job?.state === "error" ? (
      <XCircleIcon className="text-destructive" />
    ) : null;
  const title =
    job?.state === "done"
      ? job.result.status === "published"
        ? `已发布：${job.result.questions} 题 / ${job.result.totalScore} 分`
        : `已存为草稿：${job.result.warnings.join("；") || "未勾选直接发布"}`
      : job?.state === "error"
        ? job.message
        : job?.state === "queued"
          ? "排队中"
          : undefined;

  return (
    <Button
      size="xs"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      title={title}
      disabled={disabled || job?.state === "done"}
      onClick={onToggle}
      className={cn(job?.state === "queued" && "opacity-60")}
    >
      {icon}
      {LEVEL_NAMES[paper.level]}
    </Button>
  );
}
