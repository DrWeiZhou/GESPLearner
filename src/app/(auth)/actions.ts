"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  accountsEnabled,
  authenticate,
  createSession,
  destroySession,
  HttpError,
  registerUser,
  USERNAME_RE,
} from "@/lib/auth";

export type AuthState = { error?: string } | undefined;

const Credentials = z.object({
  username: z.string().trim().regex(USERNAME_RE, "用户名需为 3~20 位字母、数字、下划线或连字符"),
  password: z.string().min(6, "密码至少 6 位"),
});

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/papers";
};

function describe(err: unknown) {
  if (err instanceof HttpError) return { error: err.message };
  console.error(err);
  return { error: "服务器错误，请稍后再试" };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!accountsEnabled) return { error: "未配置数据库，当前为演示模式" };
  const parsed = Credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await authenticate(parsed.data.username, parsed.data.password);
    await createSession(user.id);
  } catch (err) {
    return describe(err);
  }
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!accountsEnabled) return { error: "未配置数据库，当前为演示模式" };
  const parsed = Credentials.extend({
    displayName: z.string().trim().max(20).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await registerUser(parsed.data);
    await createSession(user.id);
  } catch (err) {
    return describe(err);
  }
  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  await destroySession();
  redirect("/");
}
