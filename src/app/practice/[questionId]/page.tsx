import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { LevelBadge } from "@/components/common/level-badge";
import { PracticeObjective } from "@/components/question/practice-objective";
import { ProgrammingWorkspace } from "@/components/question/programming-workspace";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getQuestion } from "@/lib/content";
import { formatExamId, QUESTION_TYPE_LABEL } from "@/lib/format";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/practice/[questionId]">) {
  const { questionId } = await params;
  const found = await getQuestion(questionId);
  if (!found) return { title: "题目" };
  const { paper, question } = found;
  const name = question.type === "programming" ? question.title : `${QUESTION_TYPE_LABEL[question.type]}第${question.number}题`;
  return { title: `${name} · C++${LEVEL_NAMES[paper.level]}` };
}

export default function PracticePage({ params }: PageProps<"/practice/[questionId]">) {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-[70vh]" />}>
      <QuestionView params={params} />
    </Suspense>
  );
}

async function QuestionView({ params }: { params: PageProps<"/practice/[questionId]">["params"] }) {
  const { questionId } = await params;
  const found = await getQuestion(questionId);
  if (!found) notFound();
  const { paper, question, prevId, nextId } = found;
  const programming = question.type === "programming";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", programming && "h-[calc(100vh-7.5rem)]")}>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <Link href={`/papers/${paper.id}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {formatExamId(paper.examId)}
        </Link>
        <LevelBadge level={paper.level} className="text-xs" />
        <div className="ml-auto flex gap-2">
          <Link
            href={prevId ? `/practice/${prevId}` : "#"}
            aria-disabled={!prevId}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), !prevId && "pointer-events-none opacity-50")}
          >
            <ChevronLeftIcon /> 上一题
          </Link>
          <Link
            href={nextId ? `/practice/${nextId}` : "#"}
            aria-disabled={!nextId}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), !nextId && "pointer-events-none opacity-50")}
          >
            下一题 <ChevronRightIcon />
          </Link>
        </div>
      </div>

      {programming ? (
        <ProgrammingWorkspace question={question} />
      ) : (
        <div className="mx-auto w-full max-w-3xl px-4 py-8">
          <PracticeObjective question={question} />
        </div>
      )}
    </div>
  );
}
