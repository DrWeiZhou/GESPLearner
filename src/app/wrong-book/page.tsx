import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { LevelBadge } from "@/components/common/level-badge";
import { RequireLogin } from "@/components/common/require-login";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { formatExamId, QUESTION_TYPE_LABEL } from "@/lib/format";
import { getWrongQuestions } from "@/lib/stats";

export const metadata: Metadata = { title: "错题本" };

export default function WrongBookPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">错题本</h1>
      <p className="mb-6 text-sm text-muted-foreground">做错过的题目会自动收录，重做答对后标记为已掌握。</p>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <WrongList />
      </Suspense>
    </div>
  );
}

async function WrongList() {
  const user = await getCurrentUser();
  if (!user) return <RequireLogin next="/wrong-book" />;

  const items = await getWrongQuestions(user.id);
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          还没有错题，继续加油！
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.questionId}>
          <Link
            href={`/practice/${item.questionId}`}
            className="block rounded-xl border p-4 transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <LevelBadge level={item.level} />
              <span className="text-muted-foreground">{formatExamId(item.examId)}</span>
              <Badge variant="outline">
                {QUESTION_TYPE_LABEL[item.type]} 第 {item.number} 题
              </Badge>
              <span className="text-muted-foreground">错 {item.wrongCount} 次</span>
              {item.resolved && (
                <Badge className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-3" /> 已掌握
                </Badge>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm">
              {item.title ?? item.stem.replace(/[#*`$]/g, "").slice(0, 120)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
