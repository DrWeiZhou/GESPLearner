"use client";

import { CoinsIcon, Loader2Icon, PlayIcon, RotateCcwIcon, SendIcon, SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/common/markdown";
import type { OnMount } from "@monaco-editor/react";
import { CodeEditor, DEFAULT_CPP_TEMPLATE } from "@/components/question/code-editor";
import { JudgeResultView, RunResultView } from "@/components/question/judge-result";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { loadDraft, postJSON, saveDraft } from "@/lib/api";
import { formatReward } from "@/lib/format";
import type { CoinReward, JudgeResult, PublicProgramming, RunResult, TutorContext } from "@/lib/types";

type Panel = "run" | "judge" | "tutor";

/** `/api/submit` settles the question's coins along with the verdict. */
type SubmitResponse = JudgeResult & { reward?: CoinReward | null };

/**
 * Online-IDE workspace for one programming question.
 * `onJudged` lets the mock-exam page track the best submission per question.
 */
export function ProgrammingWorkspace({
  question,
  attemptId,
  onJudged,
}: {
  question: PublicProgramming;
  attemptId?: string | null;
  onJudged?: (result: JudgeResult) => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(DEFAULT_CPP_TEMPLATE);
  const [stdin, setStdin] = useState(question.samples[0]?.input ?? "");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);
  const [reward, setReward] = useState<CoinReward | null>(null);
  const [pending, setPending] = useState<"run" | "submit" | null>(null);
  const [panel, setPanel] = useState<Panel>("run");

  // Restore the saved draft when Monaco mounts: localStorage isn't available during
  // SSR, and doing it here (an event, not render) avoids a hydration mismatch.
  const restoreDraft: OnMount = (editor) => {
    const draft = loadDraft(question.id);
    if (draft && draft !== code) {
      editor.setValue(draft);
      setCode(draft);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => saveDraft(question.id, code), 500);
    return () => clearTimeout(t);
  }, [code, question.id]);

  const run = async () => {
    setPending("run");
    setPanel("run");
    try {
      setRunResult(await postJSON<RunResult>("/api/run", { questionId: question.id, code, stdin }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "运行失败");
    } finally {
      setPending(null);
    }
  };

  const submit = async () => {
    setPending("submit");
    setPanel("judge");
    try {
      const { reward: settled, ...result } = await postJSON<SubmitResponse>("/api/submit", {
        questionId: question.id,
        code,
        attemptId,
      });
      setJudgeResult(result);
      setReward(settled ?? null);
      onJudged?.(result);
      if (result.verdict === "AC") toast.success(`全部通过！得分 ${result.score ?? question.score}`);
      const coins = settled ? formatReward(settled) : null;
      if (coins) toast.success(coins, { icon: "🪙" });
      // The balance in the header is rendered on the server.
      if (settled?.credited) router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "评测失败");
    } finally {
      setPending(null);
    }
  };

  const tutorContext = (): TutorContext => ({ kind: "programming", code, judge: judgeResult });

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize="42%" minSize="25%" className="overflow-y-auto">
        <Statement question={question} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="58%" minSize="30%">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize="62%" minSize="25%">
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <span className="text-sm font-medium">C++ 代码</span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCode(DEFAULT_CPP_TEMPLATE);
                      toast.info("已重置为代码模板");
                    }}
                  >
                    <RotateCcwIcon /> 重置
                  </Button>
                  <Button variant="outline" size="sm" onClick={run} disabled={pending !== null}>
                    {pending === "run" ? <Loader2Icon className="animate-spin" /> : <PlayIcon />} 运行
                  </Button>
                  <Button size="sm" onClick={submit} disabled={pending !== null}>
                    {pending === "submit" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} 提交评测
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <CodeEditor value={code} onChange={setCode} onMount={restoreDraft} />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="38%" minSize="20%">
            <Tabs value={panel} onValueChange={(v) => setPanel(v as Panel)} className="flex h-full flex-col gap-0">
              <TabsList className="shrink-0 rounded-none border-b px-3">
                <TabsTrigger value="run">自测运行</TabsTrigger>
                <TabsTrigger value="judge">评测结果</TabsTrigger>
                <TabsTrigger value="tutor">
                  <SparklesIcon className="size-3.5" /> AI 讲解
                </TabsTrigger>
              </TabsList>

              <TabsContent value="run" className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-2 p-4">
                  <label htmlFor="stdin" className="text-xs font-medium text-muted-foreground">
                    测试输入（stdin）
                  </label>
                  <Textarea
                    id="stdin"
                    value={stdin}
                    onChange={(e) => setStdin(e.target.value)}
                    rows={4}
                    className="font-mono text-xs"
                    placeholder="在此粘贴输入数据"
                  />
                  {question.samples.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {question.samples.map((s, i) => (
                        <Button key={i} variant="outline" size="xs" onClick={() => setStdin(s.input)}>
                          载入样例 {i + 1}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                {runResult && <RunResultView result={runResult} />}
              </TabsContent>

              <TabsContent value="judge" className="min-h-0 flex-1 overflow-y-auto">
                {judgeResult ? (
                  <>
                    {reward && <RewardNote reward={reward} />}
                    <JudgeResultView result={judgeResult} />
                  </>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">
                    点击「提交评测」后，这里会显示每个测试点的结果。
                    <br />
                    本题的金币按<b>第一次提交</b>的得分结算，之后再提交不再发放，建议先用「自测运行」确认代码没问题。
                  </p>
                )}
              </TabsContent>

              <TabsContent value="tutor" className="min-h-0 flex-1">
                <TutorPanel
                  questionId={question.id}
                  context={tutorContext}
                  trigger="请分析我的代码"
                  emptyHint="AI 老师会结合你的代码和评测结果，指出问题所在并给出修改提示。"
                  className="h-full"
                />
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** Coins the first submission settled — shown above the test-point results. */
function RewardNote({ reward }: { reward: CoinReward }) {
  const text = formatReward(reward);
  if (!text) return null;
  return (
    <p className="flex items-center gap-1.5 border-b bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400">
      <CoinsIcon className="size-4" /> {text}
    </p>
  );
}

function Statement({ question: q }: { question: PublicProgramming }) {
  return (
    <article className="space-y-4 p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">编程题 第 {q.number} 题</Badge>
          <span className="text-xs text-muted-foreground">{q.score} 分</span>
        </div>
        <h1 className="text-xl font-semibold">{q.title}</h1>
        <p className="text-xs text-muted-foreground">
          时间限制 {q.timeLimitMs / 1000} 秒 · 内存限制 {q.memoryLimitMb} MB
        </p>
      </header>

      <Section title="题目描述">{q.description}</Section>
      <Section title="输入格式">{q.inputFormat}</Section>
      <Section title="输出格式">{q.outputFormat}</Section>

      {q.samples.map((s, i) => (
        <div key={i} className="space-y-2">
          <h2 className="text-sm font-semibold">样例 {i + 1}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <SampleBox title="输入">{s.input}</SampleBox>
            <SampleBox title="输出">{s.output}</SampleBox>
          </div>
          {s.explanation && <Section title={`样例 ${i + 1} 解释`}>{s.explanation}</Section>}
        </div>
      ))}

      {q.dataRange && <Section title="数据范围">{q.dataRange}</Section>}
    </article>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Markdown>{children}</Markdown>
    </section>
  );
}

function SampleBox({ title, children }: { title: string; children: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre">{children}</pre>
    </div>
  );
}
