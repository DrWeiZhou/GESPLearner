"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJSON } from "@/lib/api";

/**
 * The questions still waiting for a knowledge-point verdict.
 *
 * Grading already schedules the judging in the background, so normally there is
 * nothing here. When there is — the background task was cut short, or the syllabus
 * was re-imported — opening the wrong-answer book asks the server to catch up, one
 * batch at a time, and refreshes the page as verdicts land.
 */
export function ClassifyPending({ count }: { count: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One automatic attempt per mount, however many times this re-renders.
  const started = useRef(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const { classified } = await postJSON<{ classified: number; remaining: number }>(
        "/api/wrong-book/classify",
        {},
      );
      // Refreshing re-renders the list, which re-mounts this with whatever is left.
      if (classified > 0) router.refresh();
      else setError("大模型暂时没能判定这些题目，稍后可以再试一次");
    } catch (err) {
      setError(err instanceof Error ? err.message : "判定失败");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" /> 正在判定 {count} 道题的知识点…
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={run}>
        <SparklesIcon /> 判定这 {count} 道题的知识点
      </Button>
      {error && <span className="text-xs text-muted-foreground">{error}</span>}
    </div>
  );
}
