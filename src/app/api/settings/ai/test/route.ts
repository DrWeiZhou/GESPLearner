import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { testAISettings } from "@/lib/ai/settings";

export const maxDuration = 30;

const Body = z.object({
  baseUrl: z.httpUrl().max(300),
  apiKey: z.string().max(500).optional(),
  chatModel: z.string().trim().min(1).max(100),
});

/** Admin only: send one tiny completion with the form's values before saving them. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    return Response.json(await testAISettings(Body.parse(await req.json())));
  } catch (err) {
    return errorResponse(err);
  }
}
