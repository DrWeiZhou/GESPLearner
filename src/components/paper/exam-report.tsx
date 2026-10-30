"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2Icon, CoinsIcon, Loader2Icon, SparklesIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { postJSON } from "@/lib/api";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/common/markdown";
import { QUESTION_TYPE_LABEL } from "@/lib/format";
import type { ExamReport, ReportItem } from "@/lib/grading";
import type { PaperDetail, TutorContext } from "@/lib/types";
import { cn } from "@/lib/utils";

const tfText = (a: string | null) =>
  a === "T" ? "正确√" : a === "F" ? "错误×" : "未作答";

/** Score report shown right after 交卷, with per-question review and AI explanations. */
export function ExamReportView({
  paper,
  report,
}: {
  paper: PaperDetail;
  report: ExamReport;
}) {
  const percent = report.maxScore
    ? Math.round((report.score / report.maxScore) * 100)
    : 0;
  const wrong = report.items.filter((i) => !i.correct);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <Card className="mb-8">
        <CardContent className="py-8 text-center">
          <div className="text-sm text-muted-foreground">本次得分</div>
          <div className="mt-1 text-5xl font-bold tabular-nums">
            {report.score}
            <span className="text-2xl font-normal text-muted-foreground">
              {" "}
              / {report.maxScore}
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            正确率 {percent}%　·　答对 {report.items.length - wrong.length}/
            {report.items.length} 题
            {percent >= 70
              ? "　🎉 达到合格线（70 分）"
              : "　距离合格线还需努力"}
          </p>
          {report.attemptId && <RedeemCoins attemptId={report.attemptId} />}
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href={`/papers/${paper.id}`}
              className={buttonVariants({ variant: "outline" })}
            >
              返回试卷
            </Link>
            <Link href="/dashboard" className={buttonVariants()}>
              查看学习报告
            </Link>
          </div>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">逐题回顾</h2>
      <div className="space-y-3">
        {report.items.map((item) => (
          <ReviewRow key={item.questionId} item={item} paper={paper} />
        ))}
      </div>
    </div>
  );
}

function ReviewRow({ item, paper }: { item: ReportItem; paper: PaperDetail }) {
  const [open, setOpen] = useState(false);
  const [tutor, setTutor] = useState(false);
  const question = paper.questions.find((q) => q.id === item.questionId);
  if (!question) return null;

  const isTF = item.type === "true_false";
  const fmt = isTF ? tfText : (a: string | null) => a ?? "未作答";

  return (
    <Card className={cn(!item.correct && "border-rose-500/40")}>
      <CardHeader>
        {/* CardHeader is a grid, so the row lives in its own flex container. */}
        <div className="flex items-center gap-3">
          {item.correct ? (
            <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600" />
          ) : (
            <XCircleIcon className="size-5 shrink-0 text-rose-600" />
          )}
          <CardTitle className="min-w-0 flex-1 text-sm font-medium">
            {QUESTION_TYPE_LABEL[item.type]} 第 {item.number} 题
            {item.type === "programming" ? (
              <span className="ml-2 font-normal text-muted-foreground">
                通过 {item.passed}/{item.total} 个测试点
              </span>
            ) : (
              <span className="ml-2 font-normal text-muted-foreground">
                你的答案 {fmt(item.studentAnswer)}
                {!item.correct && ` · 正确答案 ${fmt(item.correctAnswer)}`}
              </span>
            )}
          </CardTitle>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {item.earned}/{item.score}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "收起" : "查看"}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 border-t pt-4">
          <Markdown>
            {question.type === "programming"
              ? question.description
              : question.stem}
          </Markdown>
          {question.type === "single_choice" && (
            <ul className="space-y-1.5 text-sm">
              {question.options.map((o) => (
                <li
                  key={o.label}
                  className={cn(
                    "flex gap-2 rounded-md px-2 py-1",
                    o.label === item.correctAnswer && "bg-emerald-500/10",
                    o.label === item.studentAnswer &&
                      o.label !== item.correctAnswer &&
                      "bg-rose-500/10",
                  )}
                >
                  <span className="font-semibold">{o.label}.</span>
                  <Markdown className="min-w-0 flex-1">{o.content}</Markdown>
                </li>
              ))}
            </ul>
          )}

          {tutor ? (
            <Card className="overflow-hidden p-0">
              <TutorPanel
                questionId={item.questionId}
                context={(): TutorContext =>
                  item.type === "programming"
                    ? { kind: "programming", code: "", judge: null }
                    : { kind: "objective", answer: item.studentAnswer }
                }
                className="max-h-[28rem]"
              />
            </Card>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTutor(true)}
              >
                <SparklesIcon /> AI 讲解
              </Button>
              <Link
                href={`/practice/${item.questionId}`}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                重做此题
              </Link>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/** Convert this attempt's score into coins — allowed once per attempt. */
function RedeemCoins({ attemptId }: { attemptId: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done">("idle");
  const [coins, setCoins] = useState(0);

  if (state === "done") {
    return (
      <p className="mt-5 flex items-center justify-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
        <CoinsIcon className="size-4" /> 已兑换 {coins} 枚金币
      </p>
    );
  }

  return (
    <div className="mt-5">
      <Button
        variant="outline"
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          try {
            const r = await postJSON<{ coins: number }>("/api/coins/redeem", { attemptId });
            setCoins(r.coins);
            setState("done");
            toast.success(`兑换成功，获得 ${r.coins} 枚金币`);
          } catch (err) {
            setState("idle");
            toast.error(err instanceof Error ? err.message : "兑换失败");
          }
        }}
      >
        {state === "pending" ? <Loader2Icon className="animate-spin" /> : <CoinsIcon />}
        兑换金币
      </Button>
    </div>
  );
}
