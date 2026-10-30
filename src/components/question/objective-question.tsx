"use client";

import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QUESTION_TYPE_LABEL } from "@/lib/format";
import type { ObjectiveQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ObjectiveChoice = "A" | "B" | "C" | "D" | "T" | "F";

export type CheckedResult = { correct: boolean; answer: string; explanation?: string | null };

const TF_OPTIONS = [
  { label: "T" as const, content: "正确 √" },
  { label: "F" as const, content: "错误 ×" },
];

/**
 * One objective question. Grading is always server-side (`/api/answers/check`);
 * in exam mode the parent withholds `onCheck` and no answer is revealed.
 */
export function ObjectiveQuestionCard({
  question,
  value,
  onChange,
  result,
  onCheck,
  disabled,
  className,
  children,
}: {
  question: ObjectiveQuestion;
  value: ObjectiveChoice | null;
  onChange: (value: ObjectiveChoice) => void;
  result?: CheckedResult | null;
  /** Practice mode only. */
  onCheck?: () => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [checking, setChecking] = useState(false);
  const options = question.type === "single_choice" ? question.options : TF_OPTIONS;
  const locked = disabled || Boolean(result);

  return (
    <section className={cn("space-y-4", className)} aria-labelledby={`q-${question.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {QUESTION_TYPE_LABEL[question.type]} 第 {question.number} 题
        </Badge>
        <span className="text-xs text-muted-foreground">{question.score} 分</span>
        {result && (
          <Badge className={result.correct ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/15 text-rose-700 dark:text-rose-400"}>
            {result.correct ? "回答正确" : "回答错误"}
          </Badge>
        )}
      </div>

      <Markdown>{question.stem}</Markdown>

      <ul className="space-y-2">
        {options.map((opt) => {
          const selected = value === opt.label;
          const isAnswer = result?.answer === opt.label;
          const wrongPick = Boolean(result) && selected && !isAnswer;
          return (
            <li key={opt.label}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onChange(opt.label as ObjectiveChoice)}
                aria-pressed={selected}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  "hover:border-primary/50 hover:bg-muted/50 disabled:hover:border-border disabled:hover:bg-transparent",
                  selected && "border-primary bg-primary/5",
                  result && isAnswer && "border-emerald-500 bg-emerald-500/10",
                  wrongPick && "border-rose-500 bg-rose-500/10",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold",
                    selected && "border-primary bg-primary text-primary-foreground",
                    result && isAnswer && "border-emerald-500 bg-emerald-500 text-white",
                    wrongPick && "border-rose-500 bg-rose-500 text-white",
                  )}
                >
                  {result && isAnswer ? <CheckIcon className="size-3.5" /> : wrongPick ? <XIcon className="size-3.5" /> : opt.label}
                </span>
                <Markdown className="min-w-0 flex-1">{opt.content}</Markdown>
              </button>
            </li>
          );
        })}
      </ul>

      {onCheck && !result && (
        <Button
          disabled={!value || checking}
          onClick={async () => {
            setChecking(true);
            try {
              await onCheck();
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking && <Loader2Icon className="animate-spin" />}
          提交答案
        </Button>
      )}

      {result?.explanation && (
        <div className="rounded-lg border bg-muted/40 p-4">
          <h3 className="mb-2 text-sm font-semibold">参考解析</h3>
          <Markdown>{result.explanation}</Markdown>
        </div>
      )}

      {children}
    </section>
  );
}
