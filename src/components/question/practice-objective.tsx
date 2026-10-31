"use client";

import { SparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { postJSON } from "@/lib/api";
import type { ObjectiveQuestion, TutorContext } from "@/lib/types";
import { ObjectiveQuestionCard, type CheckedResult, type ObjectiveChoice } from "./objective-question";

/** Single objective question in practice mode: instant grading + AI explanation. */
export function PracticeObjective({ question }: { question: ObjectiveQuestion }) {
  const router = useRouter();
  const [value, setValue] = useState<ObjectiveChoice | null>(null);
  const [result, setResult] = useState<CheckedResult | null>(null);
  const [showTutor, setShowTutor] = useState(false);
  const answerRef = useRef<string | null>(null);

  const check = async () => {
    if (!value) return;
    try {
      const res = await postJSON<CheckedResult>("/api/answers/check", { questionId: question.id, answer: value });
      answerRef.current = value;
      setResult(res);
      // The header renders the balance and the carry on the server, and a settlement
      // can move either one.
      if (res.reward?.questions) router.refresh();
      // Wrong answers almost always need an explanation — open the tutor right away.
      if (!res.correct) setShowTutor(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败");
    }
  };

  const context = (): TutorContext => ({ kind: "objective", answer: answerRef.current });

  return (
    <ObjectiveQuestionCard question={question} value={value} onChange={setValue} result={result} onCheck={check}>
      {result && (
        <div className="space-y-3">
          {!showTutor && (
            <Button variant="outline" onClick={() => setShowTutor(true)}>
              <SparklesIcon /> 让 AI 老师讲解
            </Button>
          )}
          {showTutor && (
            <Card className="overflow-hidden p-0">
              <TutorPanel questionId={question.id} context={context} className="max-h-[32rem]" />
            </Card>
          )}
        </div>
      )}
    </ObjectiveQuestionCard>
  );
}
