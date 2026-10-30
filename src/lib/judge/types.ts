import type { RunResult } from "@/lib/types";

export type RunLimits = { timeLimitMs: number; memoryLimitMb: number };

export interface CodeRunner {
  /** Compile + run once per input. Implementations may reuse a single compilation. */
  runMany(code: string, inputs: string[], limits: RunLimits): Promise<RunResult[]>;
}
