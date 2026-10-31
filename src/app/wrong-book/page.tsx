import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { LevelBadge } from "@/components/common/level-badge";
import { RequireLogin } from "@/components/common/require-login";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClassifyPending } from "@/components/wrong-book/classify-pending";
import { getCurrentUser } from "@/lib/auth";
import { formatExamId, QUESTION_TYPE_LABEL } from "@/lib/format";
import { getWrongBook, PENDING_GROUP, type WrongGroup, type WrongItem } from "@/lib/stats";

export const metadata: Metadata = { title: "错题本" };

export default function WrongBookPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">错题本</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        做错过的题目会自动收录，并由大模型判定考查的是考试大纲里的哪个知识点，按知识点归类展示 —— 错得最多的知识点排在最前面。
        重做答对后标记为已掌握；这里的题目已经结算过金币，重做答对不会再发金币。
      </p>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <WrongList />
      </Suspense>
    </div>
  );
}

async function WrongList() {
  // These reads are per-request and hit the database. Without this the prerender
  // pass tries to run them and trips on the driver's internal clock reads, leaving
  // the Suspense boundary unresolved until the function times out.
  await connection();
  const user = await getCurrentUser();

  if (!user) return <RequireLogin next="/wrong-book" />;

  const { groups, total } = await getWrongBook(user.id);
  if (total === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          还没有错题，继续加油！
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <KnowledgeGroup key={group.key} group={group} />
      ))}
    </div>
  );
}

function KnowledgeGroup({ group }: { group: WrongGroup }) {
  const classified = group.key !== PENDING_GROUP;
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">
          {group.level !== null ? (
            <Link href={`/syllabus/${group.level}`} className="hover:underline">
              {group.title}
            </Link>
          ) : (
            group.title
          )}
        </h2>
        {group.block && <span className="text-xs text-muted-foreground">{group.block}</span>}
        {group.level !== null && <LevelBadge level={group.level} className="text-[10px]" />}
        <span className="text-xs text-muted-foreground">
          {group.items.length} 道题 · 错 {group.wrongCount} 次
          {group.mastered > 0 && ` · 已掌握 ${group.mastered} 道`}
        </span>
      </div>
      {!classified && (
        <div className="mb-2">
          <ClassifyPending count={group.items.length} />
        </div>
      )}
      <ul className="space-y-2">
        {group.items.map((item) => (
          <li key={item.questionId}>
            <WrongCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function WrongCard({ item }: { item: WrongItem }) {
  return (
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
      {item.knowledge?.reason && (
        <p className="mt-1.5 text-xs text-muted-foreground">判定依据：{item.knowledge.reason}</p>
      )}
    </Link>
  );
}
