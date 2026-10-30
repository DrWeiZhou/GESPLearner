import Link from "next/link";
import { Suspense } from "react";
import { BrainCircuitIcon, FileTextIcon, TerminalIcon, TimerIcon } from "lucide-react";
import { LevelBadge } from "@/components/common/level-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listPapers } from "@/lib/content";
import { formatExamId } from "@/lib/format";

const FEATURES = [
  { icon: FileTextIcon, title: "历年真题", text: "CCF GESP 官方历年 C++ 1~8 级真题，单选、判断、编程题完整收录。" },
  { icon: TimerIcon, title: "模拟考试", text: "按真实考试时长限时作答，交卷后自动评分并生成成绩报告。" },
  { icon: TerminalIcon, title: "在线评测", text: "内置 C++ 在线 IDE，支持自测运行与多测试点判题。" },
  { icon: BrainCircuitIcon, title: "AI 讲解", text: "结合你的错误答案和代码，逐题讲解思路、定位错因。" },
];

export default function Home() {
  return (
    <>
      <section className="border-b bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto max-w-5xl px-4 py-20 text-center">
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            GESP 备考助手
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground">
            刷真题、测代码、问 AI —— 为 CCF GESP C++ 等级认证打造的一站式备考系统。
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/papers" className={buttonVariants({ size: "lg" })}>
              开始刷题
            </Link>
            <a
              href="https://gesp.ccf.org.cn/101/1008/10012.html"
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              查看认证大纲
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <f.icon className="size-6 text-primary" />
                <CardTitle className="mt-2 text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{f.text}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-20">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-semibold">最新真题</h2>
          <Link href="/papers" className="text-sm text-primary underline-offset-4 hover:underline">
            查看全部 →
          </Link>
        </div>
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <LatestPapers />
        </Suspense>
      </section>
    </>
  );
}

async function LatestPapers() {
  "use cache";
  const papers = (await listPapers()).slice(0, 8);
  if (papers.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          题库为空：运行 <code className="rounded bg-muted px-1.5 py-0.5">bun scripts/seed.ts</code> 导入真题。
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {papers.map((p) => (
        <Link key={p.id} href={`/papers/${p.id}`} className="rounded-xl border p-4 transition-colors hover:border-primary/50 hover:bg-muted/40">
          <LevelBadge level={p.level} />
          <div className="mt-2 font-medium">{formatExamId(p.examId)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {p.counts.single_choice + p.counts.true_false} 道客观题 · {p.counts.programming} 道编程题
          </div>
        </Link>
      ))}
    </div>
  );
}
