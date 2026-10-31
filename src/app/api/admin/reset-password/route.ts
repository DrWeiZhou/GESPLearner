import { z } from "zod";
import { adminResetPassword, errorResponse, requireAdmin } from "@/lib/auth";

const Body = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(6, "新密码至少 6 位").max(100),
  adminPassword: z.string().min(1),
});

/** Admin only: set a student's password (there is no mailbox to mail a link to). */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { userId, newPassword, adminPassword } = Body.parse(await req.json());
    const { username } = await adminResetPassword({
      adminId: admin.id,
      targetUserId: userId,
      newPassword,
      adminPassword,
    });
    return Response.json({ username });
  } catch (err) {
    return errorResponse(err);
  }
}
