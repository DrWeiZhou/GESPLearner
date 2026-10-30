import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"] = [
  rehypeKatex,
  [rehypeHighlight, { detect: true, ignoreMissing: true }],
];

/** Renders question stems, options and AI answers: GFM + KaTeX + syntax highlighting. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-gesp", className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
