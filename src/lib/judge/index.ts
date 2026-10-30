import "server-only";
import type { CaseResult, JudgeResult, RunResult, Verdict } from "@/lib/types";
import type { TestCase } from "@/lib/content";
import { judge0Runner } from "./judge0";
import { localRunner } from "./local";
import type { CodeRunner, RunLimits } from "./types";

export type { RunLimits };

export function getRunner(): CodeRunner {
  const provider = process.env.JUDGE_PROVIDER ?? (process.env.JUDGE0_URL ? "judge0" : "none");
  if (provider === "judge0") {
    if (!process.env.JUDGE0_URL) throw new Error("JUDGE0_URL 未配置");
    return judge0Runner;
  }
  if (provider === "local") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_JUDGE !== "1")
      throw new Error("本地评测仅限开发环境使用");
    return localRunner;
  }
  throw new Error("未配置代码评测服务：请设置 JUDGE0_URL（或开发时 JUDGE_PROVIDER=local）");
}

export const MAX_CODE_LENGTH = 64 * 1024;
export const MAX_STDIN_LENGTH = 256 * 1024;

export async function runCode(code: string, stdin: string, limits: RunLimits): Promise<RunResult> {
  const [r] = await getRunner().runMany(code, [stdin], limits);
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
  const runs = await getRunner().runMany(code, cases.map((c) => c.input), limits);

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
