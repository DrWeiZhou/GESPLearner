import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { LevelBadge } from "@/components/common/level-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import { wrongCountByKnowledge } from "@/lib/stats";
import { getSyllabus, type KnowledgePointView } from "@/lib/syllabus/content";

const parseLevel = (value: string) => (/^[1-8]$/.test(value) ? Number(value) : null);

export async function generateMetadata({ params }: PageProps<"/syllabus/[level]">) {
  const level = parseLevel((await params).level);
  return { title: level ? `C++ ${LEVEL_NAMES[level]}考试大纲` : "考试大纲" };
}

export default function SyllabusLevelPage({ params }: PageProps<"/syllabus/[level]">) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SyllabusView params={params} />
      </Suspense>
    </div>
  );
}

async function SyllabusView({ params }: { params: PageProps<"/syllabus/[level]">["params"] }) {
  // Per-request: the student's own wrong-question counts are read below.
  await connection();
  const level = parseLevel((await params).level);
  if (!level) notFound();

  const syllabus = await getSyllabus(level);
  if (!syllabus) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          C++ {LEVEL_NAMES[level]}的考试大纲还没有导入。
        </CardContent>
      </Card>
    );
  }

  const user = await getCurrentUser();
  const wrongCounts = user ? await wrongCountByKnowledge(user.id, level) : new Map<string, number>();

  // Keep the syllabus's own order: points arrive sorted, so blocks come out in order too.
  const blocks = new Map<string, KnowledgePointView[]>();
  for (const p of syllabus.points) blocks.set(p.block, [...(blocks.get(p.block) ?? []), p]);

  return (
    <>
      <header className="mb-8">
        <LevelBadge level={level} />
        <h1 className="mt-3 text-2xl font-bold">C++ {LEVEL_NAMES[level]}考试大纲</h1>
        {syllabus.objective && <p className="mt-3 text-sm text-muted-foreground">{syllabus.objective}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          {blocks.size} 个知识块 · {syllabus.points.length} 个知识点
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/papers#l${level}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            做这一级的真题
          </Link>
          {syllabus.pdfUrl && (
            <a
              href={syllabus.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <FileTextIcon /> 官方大纲 PDF <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </header>

      <div className="space-y-6">
        {[...blocks.entries()].map(([block, points]) => (
          <section key={block}>
            <h2 className="mb-2 text-sm font-semibold">{block}</h2>
            <ul className="divide-y rounded-xl border">
              {points.map((p) => {
                const wrong = wrongCounts.get(p.id) ?? 0;
                return (
                  <li key={p.id} className="flex items-start justify-between gap-3 p-4">
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      {p.summary && <p className="mt-1 text-xs text-muted-foreground">{p.summary}</p>}
                    </div>
                    {wrong > 0 && (
                      <Link href="/wrong-book" className="shrink-0">
                        <Badge className="border-transparent bg-rose-500/15 text-rose-700 dark:text-rose-400">
                          我的错题 {wrong}
                        </Badge>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {user && wrongCounts.size === 0 && (
        <p className="mt-6 text-xs text-muted-foreground">
          这一级还没有归到大纲知识点上的错题。做错的题目会自动判定知识点，收录进
          <Link href="/wrong-book" className="text-primary hover:underline">
            错题本
          </Link>
          。
        </p>
      )}
    </>
  );
}
