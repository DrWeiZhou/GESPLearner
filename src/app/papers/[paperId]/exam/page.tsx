import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExamRunner } from "@/components/paper/exam-runner";
import { Skeleton } from "@/components/ui/skeleton";
import { getPaper } from "@/lib/content";
import { formatExamId } from "@/lib/format";
import { LEVEL_NAMES } from "@/lib/schema/paper";

export async function generateMetadata({ params }: PageProps<"/papers/[paperId]/exam">) {
  const { paperId } = await params;
  const paper = await getPaper(paperId);
  return { title: paper ? `模拟考试 · ${formatExamId(paper.examId)} C++${LEVEL_NAMES[paper.level]}` : "模拟考试" };
}

export default function ExamPage({ params }: PageProps<"/papers/[paperId]/exam">) {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-[70vh]" />}>
      <ExamView params={params} />
    </Suspense>
  );
}

async function ExamView({ params }: { params: PageProps<"/papers/[paperId]/exam">["params"] }) {
  const { paperId } = await params;
  const paper = await getPaper(paperId);
  if (!paper) notFound();
  return <ExamRunner paper={paper} />;
}
