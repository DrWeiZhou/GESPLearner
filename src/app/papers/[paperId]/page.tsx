import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLinkIcon, FileTextIcon, TimerIcon } from "lucide-react";
import { LevelBadge } from "@/components/common/level-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getPaper } from "@/lib/content";
import { formatExamId, QUESTION_TYPE_LABEL } from "@/lib/format";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import type { PublicQuestion } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/papers/[paperId]">) {
  const { paperId } = await params;
  const paper = await getPaper(paperId);
  return { title: paper ? `${formatExamId(paper.examId)} C++ ${LEVEL_NAMES[paper.level]}` : "试卷" };
}

export default function PaperPage({ params }: PageProps<"/papers/[paperId]">) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <PaperView params={params} />
      </Suspense>
    </div>
  );
}

async function PaperView({ params }: { params: PageProps<"/papers/[paperId]">["params"] }) {
  const { paperId } = await params;
  const paper = await getPaper(paperId);
  if (!paper) notFound();

  const groups = [
    { type: "single_choice", items: paper.questions.filter((q) => q.type === "single_choice") },
    { type: "true_false", items: paper.questions.filter((q) => q.type === "true_false") },
    { type: "programming", items: paper.questions.filter((q) => q.type === "programming") },
  ] as const;

  return (
    <>
      <header className="mb-8">
        <LevelBadge level={paper.level} />
        <h1 className="mt-3 text-2xl font-bold">
          {formatExamId(paper.examId)} GESP 认证 C++ {LEVEL_NAMES[paper.level]}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          共 {paper.questions.length} 题 · 满分 {paper.totalScore} 分 · 考试时长 {paper.durationMinutes} 分钟
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/papers/${paper.id}/exam`} className={buttonVariants()}>
            <TimerIcon /> 开始模拟考试
          </Link>
          {paper.questions[0] && (
            <Link href={`/practice/${paper.questions[0].id}`} className={buttonVariants({ variant: "outline" })}>
              逐题练习
            </Link>
          )}
          {paper.pdfUrl && (
            <a href={paper.pdfUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost" })}>
              <FileTextIcon /> 官方 PDF <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </header>

      <div className="space-y-6">
        {groups.map(
          ({ type, items }) =>
            items.length > 0 && (
              <Card key={type}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {QUESTION_TYPE_LABEL[type]}（{items.length} 题，每题 {items[0].score} 分）
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {items.map((q) => (
                    <Button key={q.id} variant="outline" size="sm" render={<Link href={`/practice/${q.id}`} />}>
                      {label(q)}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            ),
        )}
      </div>
    </>
  );
}

function label(q: PublicQuestion) {
  return q.type === "programming" ? `${q.number}. ${q.title}` : `第 ${q.number} 题`;
}
