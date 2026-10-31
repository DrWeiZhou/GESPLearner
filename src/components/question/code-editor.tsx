"use client";

import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { Loader2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import { Skeleton } from "@/components/ui/skeleton";

// Monaco ships with the app (copied to public/monaco by scripts/desktop/copy-monaco.mjs)
// instead of loading from the jsDelivr CDN: the editor must work offline, and the
// CDN is slow or unreachable from many networks in mainland China.
loader.config({ paths: { vs: "/monaco/vs" } });

export const DEFAULT_CPP_TEMPLATE = `#include <iostream>
using namespace std;

int main() {

    return 0;
}
`;

/** Monaco wrapper tuned for young students: bigger font, no minimap, soft wrap. */
export function CodeEditor({
  value,
  onChange,
  readOnly,
  onMount,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onMount?: OnMount;
}) {
  const { resolvedTheme } = useTheme();
  return (
    <Editor
      language="cpp"
      theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={onMount}
      loading={
        <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> 编辑器加载中…
        </div>
      }
      options={{
        readOnly,
        fontSize: 14,
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 4,
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
        smoothScrolling: true,
        renderLineHighlight: "line",
        fixedOverflowWidgets: true,
      }}
    />
  );
}

export function CodeEditorSkeleton() {
  return <Skeleton className="h-full w-full rounded-none" />;
}
