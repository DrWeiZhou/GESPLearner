import "server-only";
import type { RunResult } from "@/lib/types";
import type { Judge0Config } from "./settings";
import type { CodeRunner, RunLimits } from "./types";

/**
 * Judge0 (https://judge0.com) — self-hosted or via RapidAPI, configured from
 * /admin →「代码评测」or env (see ./settings):
 *   url          e.g. https://judge0-ce.p.rapidapi.com or http://my-judge0:2358
 *   rapidApiKey  when using RapidAPI
 *   authToken    when the instance has AUTHN_TOKEN set
 *   languageId   default 54 (C++ GCC 9.2.0)
 *   compilerOptions default "-O2 -std=c++14" (GESP uses C++14-compatible judges)
 */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, "base64").toString("utf8") : "");

// Default Judge0 caps: max_memory_limit 512000 KB, max_cpu_time_limit 15 s.
const MAX_MEMORY_KB = 512_000;

type Judge0Response = {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
  status: { id: number; description: string };
};

function headers(config: Judge0Config): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const url = new URL(config.url);
  if (config.rapidApiKey) {
    h["X-RapidAPI-Key"] = config.rapidApiKey;
    h["X-RapidAPI-Host"] = url.host;
  }
  if (config.authToken) h["X-Auth-Token"] = config.authToken;
  return h;
}

async function runOnce(config: Judge0Config, code: string, stdin: string, limits: RunLimits): Promise<RunResult> {
  const base = config.url.replace(/\/$/, "");
  const res = await fetch(`${base}/submissions?base64_encoded=true&wait=true`, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({
      source_code: b64(code),
      stdin: b64(stdin),
      language_id: config.languageId,
      compiler_options: config.compilerOptions,
      cpu_time_limit: Math.min(limits.timeLimitMs / 1000, 15),
      wall_time_limit: Math.min((limits.timeLimitMs / 1000) * 3, 20),
      memory_limit: Math.min(limits.memoryLimitMb * 1024, MAX_MEMORY_KB),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    return {
      status: "SE",
      stdout: "",
      stderr: "",
      compileOutput: "",
      timeMs: null,
      memoryKb: null,
      message: `Judge0 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    };
  }
  const r = (await res.json()) as Judge0Response;
  const out = {
    stdout: unb64(r.stdout),
    stderr: unb64(r.stderr),
    compileOutput: unb64(r.compile_output),
    timeMs: r.time ? Math.round(parseFloat(r.time) * 1000) : null,
    memoryKb: r.memory,
    message: unb64(r.message) || r.status.description,
  };
  // https://github.com/judge0/judge0/blob/master/docs/api/statuses.md
  const id = r.status.id;
  if (id === 3 || id === 4) return { status: "OK", ...out };
  if (id === 5) return { status: "TLE", ...out };
  if (id === 6) return { status: "CE", ...out };
  if (id >= 7 && id <= 12) {
    // SIGKILL/SIGSEGV near the memory cap is almost always an MLE.
    const mle = out.memoryKb !== null && out.memoryKb >= limits.memoryLimitMb * 1024 * 0.95;
    return { status: mle ? "MLE" : "RE", ...out };
  }
  return { status: "SE", ...out };
}

export const judge0Runner = (config: Judge0Config): CodeRunner => ({
  async runMany(code, inputs, limits) {
    // Run the first case alone: if it fails to compile, skip the rest.
    const first = await runOnce(config, code, inputs[0] ?? "", limits);
    if (first.status === "CE" || inputs.length <= 1) return [first];

    const rest: RunResult[] = new Array(inputs.length - 1);
    let next = 1;
    await Promise.all(
      Array.from({ length: Math.min(config.concurrency, inputs.length - 1) }, async () => {
        while (next < inputs.length) {
          const i = next++;
          rest[i - 1] = await runOnce(config, code, inputs[i], limits);
        }
      }),
    );
    return [first, ...rest];
  },
});
