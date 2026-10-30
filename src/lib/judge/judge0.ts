import "server-only";
import type { RunResult } from "@/lib/types";
import type { CodeRunner, RunLimits } from "./types";

/**
 * Judge0 (https://judge0.com) — self-hosted or via RapidAPI.
 *   JUDGE0_URL            e.g. https://judge0-ce.p.rapidapi.com or http://my-judge0:2358
 *   JUDGE0_RAPIDAPI_KEY   when using RapidAPI
 *   JUDGE0_AUTH_TOKEN     when the instance has AUTHN_TOKEN set
 *   JUDGE0_CPP_LANGUAGE_ID  default 54 (C++ GCC 9.2.0)
 *   JUDGE0_COMPILER_OPTIONS default "-O2 -std=c++14" (GESP uses C++14-compatible judges)
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

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const url = new URL(process.env.JUDGE0_URL!);
  if (process.env.JUDGE0_RAPIDAPI_KEY) {
    h["X-RapidAPI-Key"] = process.env.JUDGE0_RAPIDAPI_KEY;
    h["X-RapidAPI-Host"] = url.host;
  }
  if (process.env.JUDGE0_AUTH_TOKEN) h["X-Auth-Token"] = process.env.JUDGE0_AUTH_TOKEN;
  return h;
}

async function runOnce(code: string, stdin: string, limits: RunLimits): Promise<RunResult> {
  const base = process.env.JUDGE0_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}/submissions?base64_encoded=true&wait=true`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      source_code: b64(code),
      stdin: b64(stdin),
      language_id: Number(process.env.JUDGE0_CPP_LANGUAGE_ID ?? 54),
      compiler_options: process.env.JUDGE0_COMPILER_OPTIONS ?? "-O2 -std=c++14",
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

export const judge0Runner: CodeRunner = {
  async runMany(code, inputs, limits) {
    // Run the first case alone: if it fails to compile, skip the rest.
    const first = await runOnce(code, inputs[0] ?? "", limits);
    if (first.status === "CE" || inputs.length <= 1) return [first];

    const rest: RunResult[] = new Array(inputs.length - 1);
    const concurrency = Number(process.env.JUDGE0_CONCURRENCY ?? 4);
    let next = 1;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, inputs.length - 1) }, async () => {
        while (next < inputs.length) {
          const i = next++;
          rest[i - 1] = await runOnce(code, inputs[i], limits);
        }
      }),
    );
    return [first, ...rest];
  },
};
