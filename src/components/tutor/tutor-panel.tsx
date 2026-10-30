"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isTextUIPart, type UIMessage } from "ai";
import { Loader2Icon, SendIcon, SparklesIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/common/markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TutorContext } from "@/lib/types";
import { cn } from "@/lib/utils";

const transport = new DefaultChatTransport({ api: "/api/tutor" });

const textOf = (m: UIMessage) =>
  m.parts.filter(isTextUIPart).map((p) => p.text).join("");

/**
 * AI tutor chat. The first "讲解" click sends a trigger message; the server builds
 * the real prompt from the question, the answer key and the student's work
 * (`context`), so none of that has to be trusted from the client.
 */
export function TutorPanel({
  questionId,
  context,
  trigger = "请帮我讲解这道题",
  emptyHint,
  className,
}: {
  questionId: string;
  /** Read at send time, so the latest code / judge result is always used. */
  context: () => TutorContext;
  trigger?: string;
  emptyHint?: string;
  className?: string;
}) {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, error, stop } = useChat({
    id: questionId,
    transport,
  });

  const send = (text: string) =>
    sendMessage({ text }, { body: { questionId, context: context() } });

  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <SparklesIcon className="size-8 text-primary/60" />
            <p className="max-w-xs text-sm text-muted-foreground">
              {emptyHint ?? "让 AI 老师结合你的作答，讲解这道题的思路和易错点。"}
            </p>
            <Button onClick={() => send(trigger)} disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {trigger}
            </Button>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[90%] rounded-xl px-4 py-2.5",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {m.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap">{textOf(m)}</p>
                ) : (
                  <Markdown>{textOf(m)}</Markdown>
                )}
              </div>
            </div>
          ))
        )}
        {status === "submitted" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> AI 老师正在思考…
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message || "AI 讲解失败，请稍后重试"}</AlertDescription>
          </Alert>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length > 0 && (
        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text || busy) return;
            setInput("");
            send(text);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="继续追问，例如：为什么不能用 int？"
            disabled={busy}
          />
          {busy ? (
            <Button type="button" variant="outline" size="icon" onClick={stop} aria-label="停止">
              <SquareIcon />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="发送">
              <SendIcon />
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
