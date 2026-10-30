import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LevelBadge } from "@/components/common/level-badge";
import { RequireLogin } from "@/components/common/require-login";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { formatExamId } from "@/lib/format";
import { getAccuracyByLevel, getOverview, getRecentAttempts } from "@/lib/stats";

export const metadata: Metadata = { title: "学习报告" };

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">学习报告</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) return <RequireLogin next="/dashboard" />;

  const [overview, byLevel, recent] = await Promise.all([
    getOverview(user.id),
    getAccuracyByLevel(user.id),
    getRecentAttempts(user.id),
  ]);

  const stats = [
    { label: "累计答题", value: overview.answered },
    { label: "客观题正确率", value: `${overview.accuracy}%` },
    { label: "代码提交", value: `${overview.acSubmissions}/${overview.submissions}` },
    { label: "完成模拟考", value: overview.examCount },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="py-5">
              <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">各级别正确率</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {byLevel.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有做题记录，去「真题库」开始练习吧。</p>
          ) : (
            byLevel.map((l) => {
              const percent = Math.round((l.correct / l.answered) * 100);
              return (
                <div key={l.level} className="space-y-1.5">
                  <div className="flex items-center gap-3 text-sm">
                    <LevelBadge level={l.level} />
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {l.correct}/{l.answered} · {percent}%
                    </span>
                  </div>
                  <Progress value={percent} className="h-2" />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近的模拟考试</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有完成过模拟考试。</p>
          ) : (
            <ul className="divide-y">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <LevelBadge level={a.level} />
                  <Link href={`/papers/${a.paperId}`} className="hover:underline">
                    {formatExamId(a.examId)}认证
                  </Link>
                  <span className="ml-auto tabular-nums font-medium">
                    {a.score ?? 0}
                    <span className="text-muted-foreground"> / {a.maxScore ?? 100}</span>
                  </span>
                  <span className="w-24 text-right text-xs text-muted-foreground">
                    {a.submittedAt?.toLocaleDateString("zh-CN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
