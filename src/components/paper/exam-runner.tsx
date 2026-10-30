"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon, TimerIcon } from "lucide-react";
import { toast } from "sonner";
import { ObjectiveQuestionCard, type ObjectiveChoice } from "@/components/question/objective-question";
import { ProgrammingWorkspace } from "@/components/question/programming-workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { postJSON } from "@/lib/api";
import { formatDuration, QUESTION_TYPE_LABEL } from "@/lib/format";
import type { ExamReport } from "@/lib/grading";
import type { JudgeResult, PaperDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExamReportView } from "./exam-report";

type Attempt = { id: string | null; startedAt: string };

/**
 * Timed mock exam: one question at a time, answers kept client-side until 交卷.
 * Grading happens on the server (`/api/attempts/finish`) — no key is ever sent here.
 */
export function ExamRunner({ paper }: { paper: PaperDetail }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [starting, setStarting] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, ObjectiveChoice>>({});
  const [runs, setRuns] = useState<Record<string, { passed: number; total: number }>>({});
  const [remaining, setRemaining] = useState(paper.durationMinutes * 60);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState<ExamReport | null>(null);

  // Mirrored into a ref so finish() stays stable and the countdown isn't re-subscribed
  // on every keystroke; writing it in an effect keeps it out of render.
  const stateRef = useRef({ answers, runs, attempt, report });
  useEffect(() => {
    stateRef.current = { answers, runs, attempt, report };
  }, [answers, runs, attempt, report]);

  const finish = useCallback(
    async (auto = false) => {
      if (stateRef.current.report || submitting) return;
      setSubmitting(true);
      try {
        const result = await postJSON<ExamReport>("/api/attempts/finish", {
          paperId: paper.id,
          attemptId: stateRef.current.attempt?.id ?? null,
          answers: stateRef.current.answers,
          programming: stateRef.current.runs,
        });
        setReport(result);
        setConfirming(false);
        if (auto) toast.info("考试时间到，已自动交卷");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "交卷失败");
      } finally {
        setSubmitting(false);
      }
    },
    [paper.id, submitting],
  );

  // Countdown, driven by the server-issued start time so a reload can't extend it.
  useEffect(() => {
    if (!attempt || report) return;
    const deadline = new Date(attempt.startedAt).getTime() + paper.durationMinutes * 60_000;
    const tick = () => {
      const left = Math.round((deadline - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) void finish(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [attempt, paper.durationMinutes, report, finish]);

  const answeredCount = useMemo(
    () => paper.questions.filter((q) => (q.type === "programming" ? runs[q.id] : answers[q.id])).length,
    [paper.questions, answers, runs],
  );

  if (report) return <ExamReportView paper={paper} report={report} />;

  if (!attempt) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <TimerIcon className="mx-auto size-10 text-primary" />
            <h1 className="text-xl font-semibold">模拟考试</h1>
            <p className="text-sm text-muted-foreground">
              共 {paper.questions.length} 题 / {paper.totalScore} 分，限时 {paper.durationMinutes} 分钟。
              <br />
              开始后计时不可暂停，时间结束将自动交卷。
            </p>
            <Button
              size="lg"
              disabled={starting}
              onClick={async () => {
                setStarting(true);
                try {
                  setAttempt(await postJSON<Attempt>("/api/attempts", { paperId: paper.id, mode: "exam" }));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "无法开始考试");
                } finally {
                  setStarting(false);
                }
              }}
            >
              {starting && <Loader2Icon className="animate-spin" />}
              开始考试
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const question = paper.questions[index];
  const lowTime = remaining <= 300;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <span className={cn("flex items-center gap-1.5 font-mono text-sm font-medium", lowTime && "text-rose-600")}>
          <TimerIcon className="size-4" />
          {formatDuration(remaining)}
        </span>
        <span className="text-xs text-muted-foreground">
          已作答 {answeredCount}/{paper.questions.length}
        </span>
        <Progress value={(answeredCount / paper.questions.length) * 100} className="h-1.5 w-28" />
        <Button size="sm" className="ml-auto" onClick={() => setConfirming(true)}>
          交卷
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b px-4 py-2">
        {paper.questions.map((q, i) => {
          const done = q.type === "programming" ? runs[q.id] : answers[q.id];
          return (
            <button
              key={q.id}
              onClick={() => setIndex(i)}
              className={cn(
                "size-7 rounded-md border text-xs transition-colors",
                i === index && "border-primary ring-2 ring-primary/30",
                done ? "bg-primary/15 font-medium" : "hover:bg-muted",
              )}
              title={`${QUESTION_TYPE_LABEL[q.type]} 第 ${q.number} 题`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {question.type === "programming" ? (
        <ProgrammingWorkspace
          key={question.id}
          question={question}
          attemptId={attempt.id}
          onJudged={(r: JudgeResult) =>
            setRuns((prev) => {
              const best = prev[question.id];
              const better = !best || r.passed / Math.max(r.total, 1) > best.passed / Math.max(best.total, 1);
              return better ? { ...prev, [question.id]: { passed: r.passed, total: r.total } } : prev;
            })
          }
        />
      ) : (
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
          <ObjectiveQuestionCard
            question={question}
            value={answers[question.id] ?? null}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [question.id]: v }))}
          />
          <div className="mt-8 flex justify-between">
            <Button variant="outline" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
              上一题
            </Button>
            <Button
              variant="outline"
              disabled={index === paper.questions.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              下一题
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认交卷？</DialogTitle>
            <DialogDescription>
              {answeredCount < paper.questions.length ? (
                <span className="flex items-center gap-1.5 text-amber-600">
                  <AlertTriangleIcon className="size-4" />
                  还有 {paper.questions.length - answeredCount} 题未作答
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-emerald-600">
                  <CheckCircle2Icon className="size-4" />
                  全部题目已作答
                </span>
              )}
              　交卷后将立即评分并显示答案解析。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>继续作答</DialogClose>
            <Button onClick={() => finish()} disabled={submitting}>
              {submitting && <Loader2Icon className="animate-spin" />}
              确认交卷
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <noscript>
        <Link href={`/papers/${paper.id}`} className={buttonVariants({ variant: "link" })}>
          返回试卷
        </Link>
      </noscript>
    </div>
  );
}
