import { z } from "zod";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { getCoinRate, setCoinRate } from "@/lib/coins";

const Body = z.object({ rate: z.number().min(0).max(100) });

export async function GET() {
  try {
    return Response.json({ rate: await getCoinRate() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Admin only: coins awarded per exam point (default 0.3). */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { rate } = Body.parse(await req.json());
    return Response.json({ rate: await setCoinRate(rate, admin.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
