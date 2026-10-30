import { Badge } from "@/components/ui/badge";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import { cn } from "@/lib/utils";

/** Colour ramp: 1–2 入门, 3–4 基础, 5–6 进阶, 7–8 高阶. */
const TONE = [
  "",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  "bg-rose-500/10 text-rose-700 dark:text-rose-400",
];

export function LevelBadge({ level, className }: { level: number; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", TONE[level], className)}>
      C++ {LEVEL_NAMES[level]}
    </Badge>
  );
}
