import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { classifyQuestions } from "@/lib/knowledge/classify";
import { getWrongBook } from "@/lib/stats";
import { importedSyllabusLevels } from "@/lib/syllabus/content";

// One model call per question, a handful at a time.
export const maxDuration = 120;

/**
 * Judges which knowledge point the student's still-unclassified wrong questions
 * examine. Grading already schedules this in the background (see `after()` in
 * api/answers/check), so this is the catch-up path: it runs when the wrong-answer
 * book is opened and finds questions the background task never got to.
 */
export async function POST() {
  try {
    const user = await requireUser();
    // Without a syllabus there are no candidates, and every call would fail one
    // question at a time; say so instead.
    if ((await importedSyllabusLevels()).length === 0)
      throw new HttpError(400, "还没有导入考试大纲，无法判定知识点（请管理员在「系统设置 → 考试大纲」导入）");

    const { pending } = await getWrongBook(user.id);
    const classified = await classifyQuestions(pending);
    return Response.json({ classified, remaining: Math.max(0, pending.length - classified) });
  } catch (err) {
    return errorResponse(err);
  }
}
