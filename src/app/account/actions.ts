"use server";

import { z } from "zod";
import { changePassword, HttpError, requireUser } from "@/lib/auth";

export type PasswordState = { error?: string; message?: string } | undefined;

const Schema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: z.string().min(6, "新密码至少 6 位"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "两次输入的新密码不一致",
    path: ["confirmPassword"],
  });

export async function updatePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const parsed = Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    console.error(err);
    return { error: "服务器错误，请稍后再试" };
  }
  return { message: "密码已修改。其他设备上的登录已退出，本设备无需重新登录。" };
}
