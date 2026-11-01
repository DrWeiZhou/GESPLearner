import "server-only";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunResult } from "@/lib/types";
import { isWindows } from "@/lib/platform";
import { findCompiler, missingCompilerHint, type CompilerInfo } from "./compiler";
import type { CodeRunner } from "./types";

/**
 * Runner that compiles with the local C++ compiler (see ./compiler).
 * NOT sandboxed — fine for the desktop app, where the student runs their own code
 * on their own machine, but never for a server others can reach.
 */

const STDCXX_SHIM = `#pragma once
#include <algorithm>
#include <array>
#include <bitset>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
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
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
`;

const isWin = isWindows();

type ProcResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean };

function exec(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = 1 << 20;
    child.stdout.on("data", (d) => { if (stdout.length < cap) stdout += d; });
    child.stderr.on("data", (d) => { if (stderr.length < cap) stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, signal: null, stdout, stderr: stderr || err.message, ms: Math.round(performance.now() - start), timedOut });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, ms: Math.round(performance.now() - start), timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

/**
 * Where to compile. MinGW tools have historically choked on non-ASCII paths, and a
 * Windows user named 张三 has a temp directory under C:\Users\张三\. Fall back to
 * the always-ASCII public profile in that case.
 */
function workRoot() {
  const tmp = tmpdir();
  if (isWin && /[^\x00-\x7f]/.test(tmp)) return path.join(process.env.PUBLIC ?? "C:\\Users\\Public", "GESPLearner");
  return tmp;
}

function compileArgs(compiler: CompilerInfo, dir: string, src: string, bin: string) {
  const args = ["-O2", "-std=c++14"];
  // `bits/stdc++.h` is a libstdc++ extension that most GESP material uses, but
  // Apple clang's libc++ doesn't ship it. GCC has the real one, so only clang
  // gets the shim (putting it on GCC's include path would shadow the real header).
  if (compiler.kind === "clang") args.push("-I", dir);
  if (isWin) {
    // No dependency on the toolchain's DLLs at run time, and a Linux-sized stack:
    // Windows' default 1 MB overflows on the deep recursion typical of OI code.
    args.push("-static", "-Wl,--stack,268435456");
  }
  args.push("-o", bin, src);
  return args;
}

/**
 * The compiler's own directory first in PATH, so MinGW finds its helpers and DLLs,
 * and its temp files in our (ASCII) work folder: GCC writes intermediate objects to
 * %TEMP%, which for a Windows user named 张三 is a path the assembler can't open.
 */
function toolEnv(compiler: CompilerInfo, workDir: string): NodeJS.ProcessEnv {
  const bin = path.dirname(compiler.path);
  return {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    TMP: workDir,
    TEMP: workDir,
    TMPDIR: workDir,
  };
}

const systemError = (message: string): RunResult => ({
  status: "SE",
  stdout: "",
  stderr: "",
  compileOutput: "",
  timeMs: null,
  memoryKb: null,
  message,
});

/** A runner bound to one compiler: `preferred` from /admin, otherwise detected. */
export function createLocalRunner(preferred?: string | null): CodeRunner {
  return {
    async runMany(code, inputs, limits) {
      const compiler = await findCompiler(preferred);
      if (!compiler) {
        const hint = preferred ? `无法运行编译器「${preferred}」，请在「系统设置 → 代码评测」检查路径` : missingCompilerHint();
        return [systemError(hint)];
      }

      const root = workRoot();
      await mkdir(root, { recursive: true });
      const dir = await mkdtemp(path.join(root, "gesp-judge-"));
      try {
        const src = path.join(dir, "main.cpp");
        const bin = path.join(dir, isWin ? "main.exe" : "main");
        await writeFile(src, code);
        if (compiler.kind === "clang") {
          await mkdir(path.join(dir, "bits"), { recursive: true });
          await writeFile(path.join(dir, "bits", "stdc++.h"), STDCXX_SHIM);
        }

        const env = toolEnv(compiler, dir);
        const compile = await exec(compiler.path, compileArgs(compiler, dir, src, bin), "", 60_000, { cwd: dir, env });
        const tidy = (s: string) => s.replaceAll(dir + path.sep, "").replaceAll(dir.replaceAll("\\", "/") + "/", "");
        if (compile.code !== 0) {
          return [
            {
              status: "CE",
              stdout: "",
              stderr: "",
              compileOutput: compile.timedOut ? "编译超时（60 秒）" : tidy(compile.stderr) || `编译器退出码 ${compile.code}`,
              timeMs: null,
              memoryKb: null,
            },
          ];
        }

        // Wall-clock here includes process spawn, and on macOS the *first* execution of a
        // freshly linked binary also pays for code signing (~0.5 s) — enough to look like
        // a TLE for a trivial program. Calibrate with a no-op binary and warm up the real
        // one, then report times relative to that floor. Still an approximation of the
        // CPU time a real judge measures.
        const noopSrc = path.join(dir, "noop.cpp");
        const noop = path.join(dir, isWin ? "noop.exe" : "noop");
        await writeFile(noopSrc, "int main(){return 0;}\n");
        await exec(compiler.path, ["-O2", ...(isWin ? ["-static"] : []), "-o", noop, noopSrc], "", 60_000, { cwd: dir, env });
        await exec(noop, [], "", 10_000, { cwd: dir });
        const baseline = (await exec(noop, [], "", 10_000, { cwd: dir })).ms;
        await exec(bin, [], "", Math.min(limits.timeLimitMs * 2, 5_000), { cwd: dir });

        const results: RunResult[] = [];
        for (const input of inputs) {
          const p = await exec(bin, [], input, limits.timeLimitMs * 2 + baseline, { cwd: dir });
          const timeMs = Math.max(0, p.ms - baseline);
          const tle = p.timedOut || timeMs > limits.timeLimitMs;
          results.push({
            status: tle ? "TLE" : p.code === 0 ? "OK" : "RE",
            stdout: p.stdout,
            stderr: p.stderr || (p.signal ? `进程被信号 ${p.signal} 终止` : p.code ? `退出码 ${p.code}` : ""),
            compileOutput: tidy(compile.stderr),
            timeMs,
            memoryKb: null,
          });
        }
        return results;
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

/** Automatically detected compiler; used by scripts/gen-tests.ts. */
export const localRunner: CodeRunner = createLocalRunner();
