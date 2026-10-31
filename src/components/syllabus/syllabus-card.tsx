import Link from "next/link";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SyllabusView } from "@/lib/syllabus/content";

/**
 * The syllabus strip shown under each level heading in the paper library, above its papers: what the level
 * examines, in the syllabus's own words, and a way into the full knowledge-point list.
 */
export function SyllabusCard({ syllabus, points = 10 }: { syllabus: SyllabusView; points?: number }) {
  const shown = syllabus.points.slice(0, points);
  const rest = syllabus.points.length - shown.length;

  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">考试大纲 · {syllabus.points.length} 个知识点</h3>
        <div className="flex items-center gap-3 text-xs">
          <Link href={`/syllabus/${syllabus.level}`} className="text-primary hover:underline">
            查看完整大纲
          </Link>
          {syllabus.pdfUrl && (
            <a
              href={syllabus.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <FileTextIcon className="size-3" /> 官方 PDF <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </div>
      {syllabus.objective && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{syllabus.objective}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {shown.map((p) => (
          <Badge key={p.id} variant="outline" className="font-normal">
            {p.name}
          </Badge>
        ))}
        {rest > 0 && <Badge variant="outline" className="font-normal text-muted-foreground">+{rest}</Badge>}
      </div>
    </div>
  );
}
