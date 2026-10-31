import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { clearAISettings, getAISettingsView, saveAISettings } from "@/lib/ai/settings";

const modelName = z.string().trim().min(1).max(100).regex(/^\S+$/, "模型名不能包含空格");

const Body = z.object({
  baseUrl: z.httpUrl().max(300),
  apiKey: z.string().max(500).optional(),
  chatModel: modelName,
  visionModel: modelName,
  embeddingModel: modelName,
});

/** Admin only: the effective LLM settings (the API key is never returned, only its last 4 characters). */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getAISettingsView());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    await saveAISettings(Body.parse(await req.json()), admin.id);
    return Response.json(await getAISettingsView());
  } catch (err) {
    return errorResponse(err);
  }
}

/** Drop the admin-saved settings and fall back to env vars. */
export async function DELETE() {
  try {
    await requireAdmin();
    await clearAISettings();
    return Response.json(await getAISettingsView());
  } catch (err) {
    return errorResponse(err);
  }
}
