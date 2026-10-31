import "server-only";
import { eq } from "drizzle-orm";
import { HumanMessage } from "@langchain/core/messages";
import { getDb, isDatabaseConfigured } from "@/db";
import { AI_SETTINGS_KEY, appSettings } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { isSecretBoxConfigured, seal } from "@/lib/secret-box";
import {
  buildChatModel,
  envModels,
  loadAIConfig,
  readStoredAISettings,
  type AIConfigSource,
  type StoredAISettings,
} from "./model";

/** What the admin page may see: never the key itself, only its last 4 characters. */
export type AISettingsView = {
  source: AIConfigSource | "none";
  baseUrl: string;
  apiKeyHint: string | null;
  chatModel: string;
  visionModel: string;
  embeddingModel: string;
  updatedAt: string | null;
  /** Why the form can't save, e.g. SETTINGS_SECRET missing. */
  saveBlockedReason: string | null;
  /** The effective config failed to load (e.g. the saved key can't be decrypted). */
  error: string | null;
};

export type AISettingsInput = {
  baseUrl: string;
  /** Blank keeps the saved key. */
  apiKey?: string;
  chatModel: string;
  visionModel: string;
  embeddingModel: string;
};

const hint = (key: string) => key.slice(-4);

function saveBlockedReason() {
  if (!isDatabaseConfigured) return "未配置数据库，无法保存到后台";
  if (!isSecretBoxConfigured()) return "SETTINGS_SECRET 少于 16 位，API key 无法加密保存";
  return null;
}

export async function getAISettingsView(): Promise<AISettingsView> {
  const base = { saveBlockedReason: saveBlockedReason(), error: null, updatedAt: null };
  const stored = await readStoredAISettings();
  if (stored) {
    const { baseUrl, apiKeyHint, chatModel, visionModel, embeddingModel } = stored.value;
    let error: string | null = null;
    try {
      await loadAIConfig();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      ...base,
      source: "database",
      baseUrl,
      apiKeyHint,
      chatModel,
      visionModel,
      embeddingModel,
      updatedAt: stored.updatedAt.toISOString(),
      error,
    };
  }
  const c = await loadAIConfig();
  if (c) {
    const { baseUrl, apiKey, chatModel, visionModel, embeddingModel, source } = c;
    return { ...base, source, baseUrl, apiKeyHint: hint(apiKey), chatModel, visionModel, embeddingModel };
  }
  return { ...base, source: "none", baseUrl: "", apiKeyHint: null, ...envModels() };
}

export async function saveAISettings(input: AISettingsInput, adminId: string) {
  const blocked = saveBlockedReason();
  if (blocked) throw new HttpError(400, blocked);

  const apiKey = input.apiKey?.trim();
  let sealed: Pick<StoredAISettings, "apiKey" | "apiKeyHint">;
  if (apiKey) {
    sealed = { apiKey: seal(apiKey), apiKeyHint: hint(apiKey) };
  } else {
    const stored = await readStoredAISettings();
    if (!stored) throw new HttpError(400, "请填写 API key");
    sealed = { apiKey: stored.value.apiKey, apiKeyHint: stored.value.apiKeyHint };
  }

  const value: StoredAISettings = {
    baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
    chatModel: input.chatModel.trim(),
    visionModel: input.visionModel.trim(),
    embeddingModel: input.embeddingModel.trim(),
    ...sealed,
  };
  await getDb()
    .insert(appSettings)
    .values({ key: AI_SETTINGS_KEY, value, updatedBy: adminId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: adminId, updatedAt: new Date() } });
}

/** Back to env vars / `.z-ai-config`. */
export async function clearAISettings() {
  if (!isDatabaseConfigured) return;
  await getDb().delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
}

/**
 * One tiny chat completion with the form's values. A blank key means "the key in
 * effect right now", so the admin can test a model change without re-typing it.
 */
export async function testAISettings(input: Pick<AISettingsInput, "baseUrl" | "apiKey" | "chatModel">) {
  let apiKey = input.apiKey?.trim();
  let extra = {};
  if (!apiKey) {
    const current = await loadAIConfig().catch((err) => {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    });
    if (!current) throw new HttpError(400, "请填写 API key");
    apiKey = current.apiKey;
    extra = { chatId: current.chatId, userId: current.userId, token: current.token };
  }

  const model = buildChatModel({ baseUrl: input.baseUrl.trim(), apiKey, ...extra }, input.chatModel.trim(), {
    temperature: 0,
    maxTokens: 16,
    timeout: 20_000,
  });
  const started = Date.now();
  try {
    const res = await model.invoke([new HumanMessage("请只回复两个字母：OK")]);
    return { latencyMs: Date.now() - started, reply: res.text.trim().slice(0, 60) };
  } catch (err) {
    // Provider errors are about the request (bad key, unknown model, wrong URL) — show them to the admin.
    // LangChain appends a "Troubleshooting URL" paragraph; the first line is the provider's message.
    const message = (err instanceof Error ? err.message : String(err)).split("\n")[0];
    throw new HttpError(400, `连接失败：${message.slice(0, 300)}`);
  }
}
