import "server-only";
import type { CaseResult, JudgeResult, RunResult, Verdict } from "@/lib/types";
import type { TestCase } from "@/lib/content";
import { judge0Runner } from "./judge0";
import { createLocalRunner } from "./local";
import { loadJudgeConfig } from "./settings";
import type { CodeRunner, RunLimits } from "./types";

export type { RunLimits };

/**
 * The local runner compiles and runs on this machine without a sandbox. That is
 * the point of the desktop app — the server only listens on 127.0.0.1 and runs
 * the student's own code — but a server exposed to others must use Judge0.
 */
const localAllowed = () =>
  process.env.GESP_DESKTOP === "1" || process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_JUDGE === "1";

export async function getRunner(): Promise<CodeRunner> {
  const config = await loadJudgeConfig();
  if (config.provider === "judge0") return judge0Runner(config);
  if (!localAllowed()) throw new Error("本机评测只能在桌面版或开发环境中使用，请在「系统设置 → 代码评测」配置 Judge0");
  return createLocalRunner(config.compilerPath);
}

export const MAX_CODE_LENGTH = 64 * 1024;
export const MAX_STDIN_LENGTH = 256 * 1024;

export async function runCode(code: string, stdin: string, limits: RunLimits): Promise<RunResult> {
  const [r] = await (await getRunner()).runMany(code, [stdin], limits);
  return r;
}

/** Normalise like most OJs: ignore trailing spaces on each line and trailing blank lines. */
export function normalizeOutput(s: string) {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");
}

const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + `\n…（共 ${s.length} 字符）` : s);

const VERDICT_PRIORITY: Verdict[] = ["SE", "CE", "RE", "MLE", "TLE", "WA", "AC"];

export async function judge(code: string, cases: TestCase[], limits: RunLimits): Promise<JudgeResult> {
  if (cases.length === 0) {
    return { verdict: "SE", passed: 0, total: 0, cases: [], compileOutput: "该题暂无测试数据" };
  }
  const runs = await (await getRunner()).runMany(code, cases.map((c) => c.input), limits);

  if (runs[0]?.status === "CE") {
    return { verdict: "CE", passed: 0, total: cases.length, cases: [], compileOutput: runs[0].compileOutput };
  }

  let revealedFailure = false;
  const results: CaseResult[] = cases.map((c, i) => {
    const r = runs[i];
    const verdict: Verdict =
      r.status === "OK"
        ? normalizeOutput(r.stdout) === normalizeOutput(c.expectedOutput)
          ? "AC"
          : "WA"
        : r.status;
    const result: CaseResult = { idx: c.idx, isSample: c.isSample, verdict, timeMs: r.timeMs, memoryKb: r.memoryKb };
    const reveal = c.isSample || (verdict !== "AC" && !revealedFailure);
    if (verdict !== "AC" && !c.isSample) revealedFailure = true;
    if (reveal) {
      result.input = clip(c.input);
      result.expected = clip(c.expectedOutput);
      result.actual = clip(r.stdout);
      if (r.stderr || r.message) result.stderr = clip(r.stderr || r.message || "");
    }
    return result;
  });

  const passed = results.filter((r) => r.verdict === "AC").length;
  const verdict = VERDICT_PRIORITY.find((v) => results.some((r) => r.verdict === v)) ?? "AC";
  return { verdict, passed, total: results.length, cases: results, compileOutput: runs[0]?.compileOutput ?? "" };
}
