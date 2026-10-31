import "server-only";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { getDb, isDatabaseConfigured } from "@/db";
import { AI_SETTINGS_KEY, appSettings } from "@/db/schema";
import { open, type SealedSecret } from "@/lib/secret-box";

/**
 * LLM access through LangChain's OpenAI-compatible client.
 *
 * Configuration, first match wins:
 *   1. /admin → 大模型设置, stored in `app_settings` (API key sealed with SETTINGS_SECRET)
 *   2. env: ZAI_BASE_URL + ZAI_API_KEY, AI_MODEL (default glm-4.6),
 *      AI_VISION_MODEL (glm-4.5v, used by scripts/parse.ts),
 *      AI_EMBEDDING_MODEL (embedding-3, 1024 dims, see EMBEDDING_DIMENSIONS)
 *   3. development only: a `.z-ai-config` file ({ baseUrl, apiKey, chatId?, userId?, token? })
 *      in cwd or $HOME, matching the ZAI SDK preset.
 */

export type AIConfigSource = "database" | "env" | "file";

export type AIConfig = {
  source: AIConfigSource;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  visionModel: string;
  embeddingModel: string;
  chatId?: string;
  userId?: string;
  token?: string;
};

/** Shape of the `ai_settings` row. */
export type StoredAISettings = {
  baseUrl: string;
  apiKey: SealedSecret;
  /** Last 4 characters, so the admin page can show which key is saved without decrypting it. */
  apiKeyHint: string;
  chatModel: string;
  visionModel: string;
  embeddingModel: string;
};

export const envModels = () => ({
  chatModel: process.env.AI_MODEL ?? "glm-4.6",
  visionModel: process.env.AI_VISION_MODEL ?? "glm-4.5v",
  embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "embedding-3",
});

export async function readStoredAISettings(): Promise<{ value: StoredAISettings; updatedAt: Date } | null> {
  if (!isDatabaseConfigured) return null;
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
  return row ? { value: row.value as StoredAISettings, updatedAt: row.updatedAt } : null;
}

function loadEnvOrFileConfig(): AIConfig | null {
  if (process.env.ZAI_BASE_URL && process.env.ZAI_API_KEY) {
    return {
      source: "env",
      baseUrl: process.env.ZAI_BASE_URL,
      apiKey: process.env.ZAI_API_KEY,
      ...envModels(),
      chatId: process.env.ZAI_CHAT_ID,
      userId: process.env.ZAI_USER_ID,
      token: process.env.ZAI_TOKEN,
    };
  }
  // Local convenience only — in production everything comes from the admin page or env vars.
  if (process.env.NODE_ENV !== "production") {
    for (const file of [path.join(process.cwd(), ".z-ai-config"), path.join(homedir(), ".z-ai-config")]) {
      try {
        const c = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Omit<AIConfig, "source">;
        if (c.baseUrl && c.apiKey) return { ...envModels(), ...c, source: "file" };
      } catch {
        // missing or malformed file
      }
    }
  }
  return null;
}

/**
 * Throws when the admin-saved key can't be decrypted (SETTINGS_SECRET changed or
 * missing) rather than silently falling back to another key.
 */
export async function loadAIConfig(): Promise<AIConfig | null> {
  const stored = await readStoredAISettings();
  if (stored) {
    const { baseUrl, apiKey, chatModel, visionModel, embeddingModel } = stored.value;
    try {
      return { source: "database", baseUrl, apiKey: open(apiKey), chatModel, visionModel, embeddingModel };
    } catch {
      throw new Error("后台保存的 API key 无法解密：请检查 SETTINGS_SECRET 是否与保存时一致");
    }
  }
  return loadEnvOrFileConfig();
}

export const isAIConfigured = async () => (await loadAIConfig()) !== null;

async function requireConfig() {
  const c = await loadAIConfig();
  if (!c) throw new Error("大模型未配置：请在「系统设置 → 大模型设置」中填写，或设置 ZAI_BASE_URL 和 ZAI_API_KEY");
  return c;
}

/** Zhipu / Z.ai gateways: the only providers that understand the `thinking` switch. */
const isZaiEndpoint = (baseUrl: string) => /bigmodel\.cn|z\.ai/i.test(baseUrl);

function clientOptions(c: Pick<AIConfig, "baseUrl" | "apiKey" | "chatId" | "userId" | "token">) {
  // Same headers the ZAI SDK sends, so ZAI-hosted gateways keep working.
  const defaultHeaders: Record<string, string> = { "X-Z-AI-From": "Z" };
  if (c.chatId) defaultHeaders["X-Chat-Id"] = c.chatId;
  if (c.userId) defaultHeaders["X-User-Id"] = c.userId;
  if (c.token) defaultHeaders["X-Token"] = c.token;
  return { apiKey: c.apiKey, configuration: { baseURL: c.baseUrl.replace(/\/$/, ""), defaultHeaders } };
}

export function buildChatModel(
  c: Pick<AIConfig, "baseUrl" | "apiKey" | "chatId" | "userId" | "token">,
  model: string,
  opts: { temperature?: number; maxTokens?: number; timeout?: number } = {},
) {
  return new ChatOpenAI({
    ...clientOptions(c),
    model,
    temperature: opts.temperature ?? 0.4,
    maxTokens: opts.maxTokens,
    timeout: opts.timeout,
    // GLM reasoning models think by default; tutoring wants fast, direct answers.
    // Other OpenAI-compatible APIs may reject the unknown parameter, so only send it to Zhipu.
    modelKwargs: isZaiEndpoint(c.baseUrl) ? { thinking: { type: "disabled" } } : undefined,
  });
}

export async function getChatModel(opts: { temperature?: number; vision?: boolean } = {}) {
  const c = await requireConfig();
  return buildChatModel(c, opts.vision ? c.visionModel : c.chatModel, { temperature: opts.temperature });
}

export async function getEmbeddings(dimensions: number) {
  const c = await requireConfig();
  return new OpenAIEmbeddings({ ...clientOptions(c), model: c.embeddingModel, dimensions });
}
