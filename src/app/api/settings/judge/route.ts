import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { clearJudgeSettings, getJudgeSettingsView, saveJudgeSettings } from "@/lib/judge/settings";

const Body = z.object({
  provider: z.enum(["local", "judge0"]),
  compilerPath: z.string().max(500).optional(),
  judge0Url: z.union([z.httpUrl().max(300), z.literal("")]).optional(),
  judge0Key: z.string().max(500).optional(),
});

/** Admin only: where code runs, and which compiler the local runner found. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getJudgeSettingsView());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await saveJudgeSettings(Body.parse(await req.json()), admin.id);
    return Response.json(await getJudgeSettingsView());
  } catch (err) {
    return errorResponse(err);
  }
}

/** Back to automatic detection (or env vars). */
export async function DELETE() {
  try {
    await requireAdmin();
    await clearJudgeSettings();
    return Response.json(await getJudgeSettingsView());
  } catch (err) {
    return errorResponse(err);
  }
}
