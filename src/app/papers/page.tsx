import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LevelBadge } from "@/components/common/level-badge";
import { SyllabusCard } from "@/components/syllabus/syllabus-card";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listPapers } from "@/lib/content";
import { formatExamId } from "@/lib/format";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import { listSyllabi } from "@/lib/syllabus/content";

export const metadata: Metadata = { title: "真题库" };

export default function PapersPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">真题库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按等级选择试卷，可逐题练习，也可限时模拟考试。每个等级后面附有官方考试大纲的知识点。
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PaperList />
      </Suspense>
    </div>
  );
}

async function PaperList() {
  "use cache";
  const papers = await listPapers();
  const syllabi = await listSyllabi();
  if (papers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          题库为空。运行 <code className="rounded bg-muted px-1.5 py-0.5">bun scripts/crawl.ts</code> 和{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">bun scripts/seed.ts</code> 导入真题。
        </CardContent>
      </Card>
    );
  }

  const byLevel = new Map<number, typeof papers>();
  for (const p of papers) byLevel.set(p.level, [...(byLevel.get(p.level) ?? []), p]);
  const syllabusOf = new Map(syllabi.map((s) => [s.level, s]));

  return (
    <div className="space-y-8">
      {[...byLevel.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, list]) => (
          <section key={level} id={`l${level}`}>
            <div className="mb-3 flex items-center gap-3">
              <LevelBadge level={level} />
              <h2 className="text-sm text-muted-foreground">{LEVEL_NAMES[level]} · {list.length} 套</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => (
                <Link
                  key={p.id}
                  href={`/papers/${p.id}`}
                  className="rounded-xl border p-4 transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="font-medium">{formatExamId(p.examId)}认证</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>单选 {p.counts.single_choice}</span>
                    <span>判断 {p.counts.true_false}</span>
                    <span>编程 {p.counts.programming}</span>
                    <span>{p.totalScore} 分</span>
                    <span>{p.durationMinutes} 分钟</span>
                  </div>
                </Link>
              ))}
            </div>
            {syllabusOf.has(level) && (
              <div className="mt-3">
                <SyllabusCard syllabus={syllabusOf.get(level)!} />
              </div>
            )}
          </section>
        ))}
    </div>
  );
}
