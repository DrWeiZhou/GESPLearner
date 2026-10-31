import "server-only";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Finding a C++ compiler on the student's machine.
 *
 * - Windows: the installer ships w64devkit (GCC) under `resources/toolchain`, passed
 *   in as `GESP_TOOLCHAIN_DIR`; a MinGW / MSYS2 / Dev-C++ install also works.
 * - macOS: Homebrew's `g++-N` if present (real libstdc++, like the exam judges),
 *   otherwise Apple clang from the Xcode command line tools, with a
 *   `bits/stdc++.h` shim (see local.ts).
 * - An admin can point at any compiler from /admin →「代码评测」.
 */

export type CompilerKind = "gcc" | "clang";

export type CompilerInfo = {
  path: string;
  kind: CompilerKind;
  /** First line of `--version`, e.g. "g++ (GCC) 15.2.0". */
  version: string;
  source: "settings" | "env" | "bundled" | "system";
};

const isWin = process.platform === "win32";
const exe = (name: string) => (isWin ? `${name}.exe` : name);

function versionOf(cxx: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(cxx, ["--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && out.trim() ? out.trim().split(/\r?\n/)[0] : null);
    });
  });
}

const kindOf = (version: string): CompilerKind => (/clang/i.test(version) ? "clang" : "gcc");

/** Directories in PATH, searched in order, as `which` would. */
function inPath(name: string): string[] {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(/*turbopackIgnore: true*/ dir, exe(name)))
    .filter((file) => existsSync(/*turbopackIgnore: true*/ file));
}

/** Homebrew's versioned GCC, newest first: /opt/homebrew/bin/g++-15 … */
function homebrewGcc(): string[] {
  const found: { file: string; major: number }[] = [];
  // turbopackIgnore: these are paths on the user's machine, not files to bundle.
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    if (!existsSync(/*turbopackIgnore: true*/ dir)) continue;
    for (const f of readdirSync(/*turbopackIgnore: true*/ dir)) {
      const m = /^g\+\+-(\d+)$/.exec(f);
      if (m) found.push({ file: path.join(/*turbopackIgnore: true*/ dir, f), major: Number(m[1]) });
    }
  }
  return found.sort((a, b) => b.major - a.major).map((f) => f.file);
}

/**
 * `/usr/bin/clang++` is only a shim until the command line tools are installed —
 * running it then pops up the installer dialog. Ask xcode-select first.
 */
async function xcodeClang(): Promise<string[]> {
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn("xcode-select", ["-p"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  return ok ? ["/usr/bin/clang++"] : [];
}

const WINDOWS_LOCATIONS = [
  "C:\\w64devkit\\bin\\g++.exe",
  "C:\\msys64\\ucrt64\\bin\\g++.exe",
  "C:\\msys64\\mingw64\\bin\\g++.exe",
  "C:\\MinGW\\bin\\g++.exe",
  "C:\\mingw64\\bin\\g++.exe",
  "C:\\TDM-GCC-64\\bin\\g++.exe",
  "C:\\Program Files (x86)\\Dev-Cpp\\MinGW64\\bin\\g++.exe",
  "C:\\Program Files\\Dev-Cpp\\MinGW64\\bin\\g++.exe",
];

async function candidates(): Promise<{ path: string; source: CompilerInfo["source"] }[]> {
  const list: { path: string; source: CompilerInfo["source"] }[] = [];
  if (process.env.CXX) list.push({ path: process.env.CXX, source: "env" });
  const toolchain = process.env.GESP_TOOLCHAIN_DIR;
  if (toolchain) list.push({ path: path.join(/*turbopackIgnore: true*/ toolchain, "bin", exe("g++")), source: "bundled" });

  const system: string[] = [];
  if (process.platform === "darwin") {
    system.push(...homebrewGcc(), ...(await xcodeClang()));
  } else if (isWin) {
    system.push(...inPath("g++"), ...WINDOWS_LOCATIONS.filter((f) => existsSync(/*turbopackIgnore: true*/ f)), ...inPath("clang++"));
  } else {
    system.push(...inPath("g++"), ...inPath("clang++"));
  }
  list.push(...system.map((p) => ({ path: p, source: "system" as const })));
  return list;
}

let detected: Promise<CompilerInfo | null> | null = null;

/** Runs `--version` on one path; null if it isn't a working compiler. */
export async function probeCompiler(file: string, source: CompilerInfo["source"]): Promise<CompilerInfo | null> {
  const version = await versionOf(file);
  return version ? { path: file, kind: kindOf(version), version, source } : null;
}

/**
 * The compiler the local runner uses. `preferred` (from /admin) wins when it works;
 * otherwise the first working candidate. Cached until `resetCompilerCache()`.
 */
export function findCompiler(preferred?: string | null): Promise<CompilerInfo | null> {
  if (preferred) return probeCompiler(preferred, "settings");
  detected ??= (async () => {
    for (const c of await candidates()) {
      const info = await probeCompiler(c.path, c.source);
      if (info) return info;
    }
    return null;
  })();
  return detected;
}

export function resetCompilerCache() {
  detected = null;
}

/** What to tell a student whose machine has no compiler yet. */
export function missingCompilerHint() {
  if (process.platform === "darwin")
    return "没有找到 C++ 编译器：请在「终端」中运行 xcode-select --install 安装苹果命令行工具（或用 Homebrew 安装 gcc），然后重新打开本程序";
  if (isWin)
    return "没有找到 C++ 编译器：安装包自带的编译器缺失，请重新安装本程序，或在「系统设置 → 代码评测」中指定 g++.exe 的位置";
  return "没有找到 C++ 编译器：请安装 g++（如 sudo apt install g++）";
}
