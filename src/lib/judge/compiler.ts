import "server-only";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, link, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hostPlatform, isWindows } from "@/lib/platform";

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

const isWin = isWindows();
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

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** Mirrors a directory tree with hard links: instant, and no extra disk space. */
async function linkTree(from: string, to: string) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = path.join(/*turbopackIgnore: true*/ from, entry.name);
    const dest = path.join(/*turbopackIgnore: true*/ to, entry.name);
    if (entry.isDirectory()) await linkTree(src, dest);
    else await link(src, dest);
  }
}

/**
 * MinGW's GCC works out where its own libraries live (crt2.o, libstdc++ …) from
 * the real path of its executable, through the ANSI code page. Installed under a
 * folder with Chinese characters — the default install location contains the
 * Windows user name — that path comes out as `C:/??/…` and linking fails; a
 * junction doesn't help, GCC resolves it. So the bundled toolchain gets a real
 * ASCII home in the public profile: a hard-link mirror, or a one-time copy when
 * linking isn't possible (another drive).
 */
async function asciiToolchain(dir: string): Promise<string> {
  if (!isWin || isAscii(dir)) return dir;
  // Shared by the whole process: each route bundle has its own copy of this module.
  const pending = (shared.__gespToolchainMirrors ??= new Map<string, Promise<string>>());
  let mirror = pending.get(dir);
  if (!mirror) {
    mirror = mirrorToolchain(dir);
    pending.set(dir, mirror);
  }
  return mirror;
}

async function mirrorToolchain(dir: string): Promise<string> {
  const root = path.join(/*turbopackIgnore: true*/ process.env.PUBLIC || "C:\\Users\\Public", "GESPLearner");
  let version = "";
  try {
    version = readFileSync(/*turbopackIgnore: true*/ path.join(dir, "GESP-TOOLCHAIN.txt"), "utf8");
  } catch {
    // older layout without a version stamp
  }
  const target = path.join(/*turbopackIgnore: true*/ root, `gcc-${createHash("sha256").update(dir + version).digest("hex").slice(0, 10)}`);
  const done = path.join(/*turbopackIgnore: true*/ target, ".complete");
  if (existsSync(done)) return target;

  // Built under a unique name and renamed into place, so a second process (or a
  // half-finished earlier run) can never see — or delete — a partial mirror.
  const staging = `${target}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    try {
      await linkTree(dir, staging);
    } catch (err) {
      console.error("无法为编译器创建硬链接，改为复制：", err);
      await rm(staging, { recursive: true, force: true });
      await cp(dir, staging, { recursive: true });
    }
    await writeFile(path.join(/*turbopackIgnore: true*/ staging, ".complete"), dir);
    try {
      await rename(staging, target);
    } catch {
      if (existsSync(done)) {
        await rm(staging, { recursive: true, force: true });
        return target;
      }
      // An incomplete leftover is in the way. Removing hard links / a copy never touches the original.
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
    }
    return target;
  } catch (err) {
    console.error("准备编译器目录失败：", err);
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    return existsSync(done) ? target : dir;
  }
}

async function candidates(): Promise<{ path: string; source: CompilerInfo["source"] }[]> {
  const list: { path: string; source: CompilerInfo["source"] }[] = [];
  if (process.env.CXX) list.push({ path: process.env.CXX, source: "env" });
  const toolchain = process.env.GESP_TOOLCHAIN_DIR;
  if (toolchain)
    list.push({ path: path.join(/*turbopackIgnore: true*/ await asciiToolchain(toolchain), "bin", exe("g++")), source: "bundled" });

  const system: string[] = [];
  if (hostPlatform() === "darwin") {
    system.push(...homebrewGcc(), ...(await xcodeClang()));
  } else if (isWin) {
    system.push(...inPath("g++"), ...WINDOWS_LOCATIONS.filter((f) => existsSync(/*turbopackIgnore: true*/ f)), ...inPath("clang++"));
  } else {
    system.push(...inPath("g++"), ...inPath("clang++"));
  }
  list.push(...system.map((p) => ({ path: p, source: "system" as const })));
  return list;
}

/** Process-wide state: Next.js gives every route bundle its own instance of this module. */
const shared = globalThis as unknown as {
  __gespCompiler?: Promise<CompilerInfo | null> | null;
  __gespToolchainMirrors?: Map<string, Promise<string>>;
};

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
  shared.__gespCompiler ??= (async () => {
    for (const c of await candidates()) {
      const info = await probeCompiler(c.path, c.source);
      if (info) return info;
    }
    return null;
  })();
  return shared.__gespCompiler;
}

export function resetCompilerCache() {
  shared.__gespCompiler = null;
}

/** What to tell a student whose machine has no compiler yet. */
export function missingCompilerHint() {
  if (hostPlatform() === "darwin")
    return "没有找到 C++ 编译器：请在「终端」中运行 xcode-select --install 安装苹果命令行工具（或用 Homebrew 安装 gcc），然后重新打开本程序";
  if (isWin)
    return "没有找到 C++ 编译器：安装包自带的编译器缺失，请重新安装本程序，或在「系统设置 → 代码评测」中指定 g++.exe 的位置";
  return "没有找到 C++ 编译器：请安装 g++（如 sudo apt install g++）";
}
