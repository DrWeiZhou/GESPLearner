import "server-only";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunResult } from "@/lib/types";
import type { CodeRunner } from "./types";

/**
 * Development-only runner that compiles with the local C++ compiler.
 * NOT sandboxed — never enable on a public deployment.
 */

const STDCXX_SHIM = `#pragma once
#include <algorithm>
#include <array>
#include <bitset>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <list>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
`;

type ProcResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean };

function exec(cmd: string, args: string[], stdin: string, timeoutMs: number): Promise<ProcResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 1 << 20;
    child.stdout.on("data", (d) => { if (stdout.length < cap) stdout += d; });
    child.stderr.on("data", (d) => { if (stderr.length < cap) stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, ms: Math.round(performance.now() - start), timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

export const localRunner: CodeRunner = {
  async runMany(code, inputs, limits) {
    const dir = await mkdtemp(path.join(tmpdir(), "gesp-judge-"));
    try {
      const src = path.join(dir, "main.cpp");
      const bin = path.join(dir, "main");
      await writeFile(src, code);

      // `bits/stdc++.h` is a libstdc++ extension that most GESP material uses, but
      // Apple clang's libc++ doesn't ship it. Judge0 (GCC) has it; provide a shim so
      // local development accepts the same code.
      await mkdir(path.join(dir, "bits"), { recursive: true });
      await writeFile(path.join(dir, "bits", "stdc++.h"), STDCXX_SHIM);

      const cxx = process.env.CXX ?? "g++";
      const compile = await exec(cxx, ["-O2", "-std=c++14", "-I", dir, "-o", bin, src], "", 30_000);
      if (compile.code !== 0) {
        const r: RunResult = {
          status: "CE",
          stdout: "",
          stderr: "",
          compileOutput: compile.stderr.replaceAll(dir + "/", ""),
          timeMs: null,
          memoryKb: null,
        };
        return [r];
      }
      // Wall-clock here includes process spawn, and on macOS the *first* execution of a
      // freshly linked binary also pays for code signing (~0.5 s) — enough to look like
      // a TLE for a trivial program. Calibrate with a no-op binary and warm up the real
      // one, then report times relative to that floor. Still an approximation: use
      // Judge0 in production, where CPU time is measured properly.
      const noop = path.join(dir, "noop");
      await writeFile(path.join(dir, "noop.cpp"), "int main(){return 0;}\n");
      await exec(cxx, ["-O2", "-o", noop, path.join(dir, "noop.cpp")], "", 30_000);
      await exec(noop, [], "", 10_000);
      const baseline = (await exec(noop, [], "", 10_000)).ms;
      await exec(bin, [], "", Math.min(limits.timeLimitMs * 2, 5_000));

      const results: RunResult[] = [];
      for (const input of inputs) {
        const p = await exec(bin, [], input, limits.timeLimitMs * 2 + baseline);
        const timeMs = Math.max(0, p.ms - baseline);
        const tle = p.timedOut || timeMs > limits.timeLimitMs;
        results.push({
          status: tle ? "TLE" : p.code === 0 ? "OK" : "RE",
          stdout: p.stdout,
          stderr: p.stderr || (p.signal ? `进程被信号 ${p.signal} 终止` : p.code ? `退出码 ${p.code}` : ""),
          compileOutput: compile.stderr,
          timeMs,
          memoryKb: null,
        });
      }
      return results;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
