import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, JUDGE_SETTINGS_KEY } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { open, seal, type SealedSecret } from "@/lib/secret-box";
import { findCompiler, missingCompilerHint, resetCompilerCache, type CompilerInfo } from "./compiler";

/**
 * Where code runs. First match wins:
 *   1. /admin →「代码评测」, stored in `app_settings` (a Judge0 key sealed like the LLM key)
 *   2. env: JUDGE_PROVIDER=local|judge0, JUDGE0_URL (+ JUDGE0_RAPIDAPI_KEY / JUDGE0_AUTH_TOKEN)
 *   3. the local compiler — the default for the desktop app
 */

export type JudgeProvider = "local" | "judge0";

export type StoredJudgeSettings = {
  provider: JudgeProvider;
  /** Blank = detect automatically. */
  compilerPath: string | null;
  judge0Url: string | null;
  judge0Key: SealedSecret | null;
  judge0KeyHint: string | null;
};

export type Judge0Config = {
  url: string;
  rapidApiKey?: string;
  authToken?: string;
  languageId: number;
  compilerOptions: string;
  concurrency: number;
};

export type JudgeConfig =
  | { provider: "local"; compilerPath: string | null; source: "database" | "env" | "default" }
  | ({ provider: "judge0"; source: "database" | "env" } & Judge0Config);

export type JudgeSettingsView = {
  provider: JudgeProvider;
  source: JudgeConfig["source"];
  compilerPath: string;
  /** The compiler the local runner would use right now. */
  compiler: CompilerInfo | null;
  compilerHint: string | null;
  judge0Url: string;
  judge0KeyHint: string | null;
  updatedAt: string | null;
};

export type JudgeSettingsInput = {
  provider: JudgeProvider;
  compilerPath?: string;
  judge0Url?: string;
  /** Blank keeps the saved key. */
  judge0Key?: string;
};

async function readStored(): Promise<{ value: StoredJudgeSettings; updatedAt: Date } | null> {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, JUDGE_SETTINGS_KEY));
  return row ? { value: row.value as StoredJudgeSettings, updatedAt: row.updatedAt } : null;
}

const judge0Defaults = () => ({
  languageId: Number(process.env.JUDGE0_CPP_LANGUAGE_ID ?? 54),
  compilerOptions: process.env.JUDGE0_COMPILER_OPTIONS ?? "-O2 -std=c++14",
  concurrency: Number(process.env.JUDGE0_CONCURRENCY ?? 4),
});

/** RapidAPI's gateway wants its own header; a self-hosted Judge0 takes X-Auth-Token. */
const keyHeaders = (url: string, key: string | undefined) =>
  !key ? {} : /rapidapi\.com/i.test(url) ? { rapidApiKey: key } : { authToken: key };

export async function loadJudgeConfig(): Promise<JudgeConfig> {
  const stored = await readStored();
  if (stored) {
    const s = stored.value;
    if (s.provider === "judge0" && s.judge0Url) {
      let key: string | undefined;
      try {
        key = s.judge0Key ? open(s.judge0Key) : undefined;
      } catch {
        throw new Error("后台保存的 Judge0 密钥无法解密，请在「系统设置 → 代码评测」重新填写");
      }
      return { provider: "judge0", source: "database", url: s.judge0Url, ...keyHeaders(s.judge0Url, key), ...judge0Defaults() };
    }
    return { provider: "local", source: "database", compilerPath: s.compilerPath || null };
  }

  const env = process.env.JUDGE_PROVIDER ?? (process.env.JUDGE0_URL ? "judge0" : "local");
  if (env === "judge0" && process.env.JUDGE0_URL) {
    return {
      provider: "judge0",
      source: "env",
      url: process.env.JUDGE0_URL,
      rapidApiKey: process.env.JUDGE0_RAPIDAPI_KEY,
      authToken: process.env.JUDGE0_AUTH_TOKEN,
      ...judge0Defaults(),
    };
  }
  return { provider: "local", source: process.env.JUDGE_PROVIDER ? "env" : "default", compilerPath: null };
}

export async function getJudgeSettingsView(): Promise<JudgeSettingsView> {
  const stored = await readStored();
  const config = await loadJudgeConfig().catch(() => null);
  const compilerPath = stored?.value.compilerPath ?? "";
  const compiler = await findCompiler(compilerPath || null);
  return {
    provider: config?.provider ?? stored?.value.provider ?? "local",
    source: config?.source ?? "database",
    compilerPath,
    compiler,
    compilerHint: compiler
      ? null
      : compilerPath
        ? `无法运行「${compilerPath}」：请确认路径指向 g++ 或 clang++ 可执行文件`
        : missingCompilerHint(),
    judge0Url: stored?.value.judge0Url ?? (config?.provider === "judge0" ? config.url : ""),
    judge0KeyHint: stored?.value.judge0KeyHint ?? null,
    updatedAt: stored?.updatedAt.toISOString() ?? null,
  };
}

export async function saveJudgeSettings(input: JudgeSettingsInput, adminId: string) {
  const stored = await readStored();
  const judge0Url = input.judge0Url?.trim().replace(/\/$/, "") || null;
  if (input.provider === "judge0" && !judge0Url) throw new HttpError(400, "请填写 Judge0 地址");

  const key = input.judge0Key?.trim();
  const value: StoredJudgeSettings = {
    provider: input.provider,
    compilerPath: input.compilerPath?.trim() || null,
    judge0Url,
    judge0Key: key ? seal(key) : (stored?.value.judge0Key ?? null),
    judge0KeyHint: key ? key.slice(-4) : (stored?.value.judge0KeyHint ?? null),
  };
  await getDb()
    .insert(appSettings)
    .values({ key: JUDGE_SETTINGS_KEY, value, updatedBy: adminId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: adminId, updatedAt: new Date() } });
  resetCompilerCache();
}

/** Back to env vars / automatic detection. */
export async function clearJudgeSettings() {
  await getDb().delete(appSettings).where(eq(appSettings.key, JUDGE_SETTINGS_KEY));
  resetCompilerCache();
}
