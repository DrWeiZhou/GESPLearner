"use client";

import { CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VERDICT_LABEL, type CaseResult, type JudgeResult, type RunResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  AC: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  WA: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  TLE: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  MLE: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  RE: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  CE: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  SE: "bg-muted text-muted-foreground",
};

function Pre({ title, children }: { title: string; children: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
        {children || "（空）"}
      </pre>
    </div>
  );
}

function CaseRow({ c }: { c: CaseResult }) {
  const ok = c.verdict === "AC";
  const revealed = c.input !== undefined;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {ok ? (
          <CheckCircle2Icon className="size-4 text-emerald-600" />
        ) : (
          <XCircleIcon className="size-4 text-rose-600" />
        )}
        <span className="text-sm font-medium">
          测试点 {c.idx + 1}
          {c.isSample && <span className="ml-1 text-xs text-muted-foreground">（样例）</span>}
        </span>
        <Badge className={cn("border-transparent", TONE[c.verdict])}>{VERDICT_LABEL[c.verdict]}</Badge>
        {c.timeMs !== null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ClockIcon className="size-3" />
            {c.timeMs} ms
          </span>
        )}
      </div>
      {revealed && !ok && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Pre title="输入">{c.input!}</Pre>
          <Pre title="期望输出">{c.expected ?? ""}</Pre>
          <Pre title="你的输出">{c.actual ?? ""}</Pre>
        </div>
      )}
      {c.stderr && !ok && (
        <div className="mt-3">
          <Pre title="错误信息">{c.stderr}</Pre>
        </div>
      )}
    </div>
  );
}

export function JudgeResultView({ result }: { result: JudgeResult }) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={cn("border-transparent text-sm", TONE[result.verdict])}>{VERDICT_LABEL[result.verdict]}</Badge>
        {result.verdict !== "CE" && (
          <span className="text-sm text-muted-foreground">
            通过 {result.passed}/{result.total} 个测试点
            {result.score !== undefined && ` · 得分 ${result.score}`}
          </span>
        )}
      </div>

      {result.verdict === "CE" ? (
        <Pre title="编译错误">{result.compileOutput}</Pre>
      ) : (
        <div className="space-y-2">
          {result.cases.map((c) => (
            <CaseRow key={c.idx} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function RunResultView({ result }: { result: RunResult }) {
  const failed = result.status !== "OK";
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={cn("border-transparent", failed ? TONE[result.status] : TONE.AC)}>
          {result.status === "OK" ? "运行成功" : VERDICT_LABEL[result.status]}
        </Badge>
        {result.timeMs !== null && <span className="text-xs text-muted-foreground">{result.timeMs} ms</span>}
      </div>
      {result.status === "CE" ? (
        <Pre title="编译错误">{result.compileOutput}</Pre>
      ) : (
        <>
          <Pre title="输出">{result.stdout}</Pre>
          {result.stderr && <Pre title="错误输出">{result.stderr}</Pre>}
        </>
      )}
    </div>
  );
}
