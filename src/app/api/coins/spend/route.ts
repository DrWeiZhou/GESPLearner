import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { spendCoins } from "@/lib/coins";

const Body = z.object({
  amount: z.number().positive(),
  note: z.string().trim().max(100).optional(),
});

/** Deduct coins from the signed-in student's balance (cashing them in). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { amount, note } = Body.parse(await req.json());
    return Response.json(await spendCoins({ userId: user.id, amount, note }));
  } catch (err) {
    return errorResponse(err);
  }
}
