import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LevelBadge } from "@/components/common/level-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listSyllabi } from "@/lib/syllabus/content";

export const metadata: Metadata = { title: "考试大纲" };

export default function SyllabusIndexPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">考试大纲</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          依据 CCF 官方《编程能力等级认证标准》整理的各级知识点。错题本按这些知识点归类，方便看出薄弱环节。
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <LevelList />
      </Suspense>
    </div>
  );
}

async function LevelList() {
  "use cache";
  const syllabi = await listSyllabi();
  if (syllabi.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          还没有导入考试大纲。运行 <code className="rounded bg-muted px-1.5 py-0.5">bun run syllabus</code>，
          或在「系统设置 → 考试大纲」中一键导入。
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {syllabi.map((s) => {
        const blocks = [...new Set(s.points.map((p) => p.block))];
        return (
          <li key={s.level}>
            <Link
              href={`/syllabus/${s.level}`}
              className="block rounded-xl border p-4 transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <LevelBadge level={s.level} />
                <span className="text-sm text-muted-foreground">
                  {blocks.length} 个知识块 · {s.points.length} 个知识点
                </span>
              </div>
              {s.objective && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{s.objective}</p>}
              <p className="mt-2 text-xs text-muted-foreground">{blocks.join(" · ")}</p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
