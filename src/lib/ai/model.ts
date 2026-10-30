import "server-only";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

/**
 * LLM access through LangChain's OpenAI-compatible client.
 *
 * Configuration (env, Vercel-friendly):
 *   ZAI_BASE_URL   e.g. https://open.bigmodel.cn/api/paas/v4  (any OpenAI-compatible endpoint)
 *   ZAI_API_KEY
 *   AI_MODEL                default glm-4.6
 *   AI_VISION_MODEL         default glm-4.5v   (used by scripts/parse.ts)
 *   AI_EMBEDDING_MODEL      default embedding-3 (1024 dims, see EMBEDDING_DIMENSIONS)
 * In development a `.z-ai-config` file ({ baseUrl, apiKey, chatId?, userId?, token? })
 * in cwd or $HOME is accepted as a fallback, matching the ZAI SDK preset.
 */

type ZaiConfig = { baseUrl: string; apiKey: string; chatId?: string; userId?: string; token?: string };

function loadConfig(): ZaiConfig | null {
  if (process.env.ZAI_BASE_URL && process.env.ZAI_API_KEY) {
    return {
      baseUrl: process.env.ZAI_BASE_URL,
      apiKey: process.env.ZAI_API_KEY,
      chatId: process.env.ZAI_CHAT_ID,
      userId: process.env.ZAI_USER_ID,
      token: process.env.ZAI_TOKEN,
    };
  }
  // Local convenience only — in production everything comes from env vars.
  if (process.env.NODE_ENV !== "production") {
    for (const file of [path.join(process.cwd(), ".z-ai-config"), path.join(homedir(), ".z-ai-config")]) {
      try {
        const c = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as ZaiConfig;
        if (c.baseUrl && c.apiKey) return c;
      } catch {
        // missing or malformed file
      }
    }
  }
  return null;
}

export const isAIConfigured = () => loadConfig() !== null;

function clientOptions() {
  const c = loadConfig();
  if (!c) throw new Error("大模型未配置：请设置 ZAI_BASE_URL 和 ZAI_API_KEY");
  // Same headers the ZAI SDK sends, so ZAI-hosted gateways keep working.
  const defaultHeaders: Record<string, string> = { "X-Z-AI-From": "Z" };
  if (c.chatId) defaultHeaders["X-Chat-Id"] = c.chatId;
  if (c.userId) defaultHeaders["X-User-Id"] = c.userId;
  if (c.token) defaultHeaders["X-Token"] = c.token;
  return { apiKey: c.apiKey, configuration: { baseURL: c.baseUrl.replace(/\/$/, ""), defaultHeaders } };
}

export function getChatModel(opts: { temperature?: number; vision?: boolean } = {}) {
  return new ChatOpenAI({
    ...clientOptions(),
    model: opts.vision
      ? (process.env.AI_VISION_MODEL ?? "glm-4.5v")
      : (process.env.AI_MODEL ?? "glm-4.6"),
    temperature: opts.temperature ?? 0.4,
    // GLM reasoning models think by default; tutoring wants fast, direct answers.
    modelKwargs: { thinking: { type: "disabled" } },
  });
}

export function getEmbeddings(dimensions: number) {
  return new OpenAIEmbeddings({
    ...clientOptions(),
    model: process.env.AI_EMBEDDING_MODEL ?? "embedding-3",
    dimensions,
  });
}
