import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { aiChats, answerRecords, attempts, submissions, type StoredChatMessage } from "@/db/schema";
import type { JudgeResult } from "@/lib/types";

/** All writes happen server-side after the route has authenticated the user. */

export async function recordAnswer(r: {
  userId: string;
  questionId: string;
  answer: string;
  isCorrect: boolean;
  attemptId?: string | null;
}) {
  getDb().insert(answerRecords).values({ ...r, attemptId: r.attemptId ?? null }).run();
}

export async function recordSubmission(r: {
  userId: string;
  questionId: string;
  code: string;
  result: JudgeResult;
  attemptId?: string | null;
}) {
  getDb()
    .insert(submissions)
    .values({
      userId: r.userId,
      questionId: r.questionId,
      attemptId: r.attemptId ?? null,
      code: r.code,
      verdict: r.result.verdict,
      passed: r.result.passed,
      total: r.result.total,
      // keep the per-case summary but drop revealed hidden-case contents
      results: r.result.cases.map(({ idx, isSample, verdict, timeMs, memoryKb }) => ({ idx, isSample, verdict, timeMs, memoryKb })),
      compileOutput: r.result.compileOutput.slice(0, 8000),
    })
    .run();
}

export async function saveChat(userId: string, questionId: string, messages: StoredChatMessage[]) {
  getDb()
    .insert(aiChats)
    .values({ userId, questionId, messages })
    .onConflictDoUpdate({
      target: [aiChats.userId, aiChats.questionId],
      set: { messages, updatedAt: new Date() },
    })
    .run();
}

/** The attempt if it belongs to the user and hasn't been handed in yet. */
export async function getOpenAttempt(userId: string, attemptId: string) {
  const [row] = await getDb()
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId), isNull(attempts.submittedAt)));
  return row ?? null;
}
