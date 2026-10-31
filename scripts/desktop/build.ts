/**
 * Builds the desktop app: Windows installer (.exe) and/or macOS disk images (.dmg).
 *
 *   bun scripts/desktop/build.ts               # the current platform
 *   bun scripts/desktop/build.ts --mac --win   # both (works from macOS: no native modules to cross-compile)
 *   bun scripts/desktop/build.ts --dir         # unpacked app only, no installer (fast, for testing)
 *   bun scripts/desktop/build.ts --skip-next   # reuse the last `next build`
 *   bun scripts/desktop/build.ts --dev         # no packaging: run dist-desktop with Electron
 *
 * Steps:
 *   1. a SQLite database with the bundled papers, for prerendering (prepare-db.ts)
 *   2. `next build` into .next-desktop (standalone output)
 *   3. dist-desktop/server: standalone + static assets + public + data + migrations,
 *      without platform binaries
 *   4. dist-desktop/native/<platform>-<arch>: the matching @napi-rs/canvas binary
 *   5. Windows: build-desktop/toolchain/w64devkit, a pruned GCC (downloaded once, checksum pinned)
 *   6. dist-desktop/app: the Electron main process (esbuild) + a dependency-free package.json
 *   7. electron-builder (desktop/electron-builder.cjs) → dist-desktop/release
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build as esbuild } from "esbuild";

const ROOT = path.resolve(import.meta.dir, "../..");
const DIST = path.join(ROOT, "dist-desktop");
const WORK = path.join(ROOT, "build-desktop");
const NEXT_DIR = ".next-desktop";
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const args = new Set(process.argv.slice(2));
const wantMac = args.has("--mac") || (!args.has("--win") && !args.has("--dev") && process.platform === "darwin");
const wantWin = args.has("--win") || (!args.has("--mac") && !args.has("--dev") && process.platform === "win32");
const macArchs = args.has("--arm64") ? ["arm64"] : args.has("--x64") ? ["x64"] : ["arm64", "x64"];

const W64DEVKIT = {
  version: "2.11.0",
  file: "w64devkit-x64-2.11.0.7z.exe",
  sha256: "54c2bb9962e8a30c8270e34c5efc3d5fee579f53087fa7d435b95fbba2af7b2b",
};

const step = (msg: string) => console.log(`\n▶ ${msg}`);

function run(cmd: string, argv: string[], env: Record<string, string> = {}) {
  execFileSync(cmd, argv, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
}

function which(names: string[]) {
  for (const name of names) {
    try {
      execFileSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore" });
      return name;
    } catch {
      // try the next one
    }
  }
  return null;
}

// ───────────────────────── 1–2. next build ─────────────────────────

function nextBuild() {
  step("复制 Monaco 编辑器");
  run("node", ["scripts/desktop/copy-monaco.mjs"]);

  step("准备构建用数据库（迁移 + 内置题库）");
  const buildDb = path.join(WORK, "build.db");
  run("bun", ["--conditions", "react-server", "scripts/desktop/prepare-db.ts", buildDb, "--fresh"]);

  step("next build（standalone）");
  rmSync(path.join(ROOT, NEXT_DIR), { recursive: true, force: true });
  run("bunx", ["next", "build"], {
    NEXT_DIST_DIR: NEXT_DIR,
    GESP_DB_PATH: buildDb,
    GESP_DESKTOP: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  });
}

// ───────────────────────── 3. server ─────────────────────────

/** Copies a tree, replacing symlinks with what they point at (NSIS can't store links). */
function copyResolved(from: string, to: string) {
  cpSync(from, to, { recursive: true, dereference: true, verbatimSymlinks: false });
}

function assembleServer() {
  step("组装服务目录 dist-desktop/server");
  const standalone = path.join(ROOT, NEXT_DIR, "standalone");
  const server = path.join(DIST, "server");
  rmSync(server, { recursive: true, force: true });
  mkdirSync(server, { recursive: true });

  for (const entry of readdirSync(standalone)) {
    const from = path.join(standalone, entry);
    // Turbopack links externals as <distDir>/node_modules/<pkg>-<hash> → ../../node_modules/<pkg>.
    copyResolved(from, path.join(server, entry));
  }
  copyResolved(path.join(ROOT, NEXT_DIR, "static"), path.join(server, NEXT_DIR, "static"));
  copyResolved(path.join(ROOT, "public"), path.join(server, "public"));
  copyResolved(path.join(ROOT, "drizzle"), path.join(server, "drizzle"));
  for (const dir of ["papers", "syllabus", "tests"]) {
    const from = path.join(ROOT, "data", dir);
    if (existsSync(from)) copyResolved(from, path.join(server, "data", dir));
  }

  // Platform binaries come per target (step 4); sharp only serves next/image, which the app doesn't use.
  const nm = path.join(server, "node_modules");
  for (const rel of ["sharp", "@img"]) rmSync(path.join(nm, rel), { recursive: true, force: true });
  for (const name of existsSync(path.join(nm, "@napi-rs")) ? readdirSync(path.join(nm, "@napi-rs")) : [])
    if (name.startsWith("canvas-")) rmSync(path.join(nm, "@napi-rs", name), { recursive: true, force: true });

  // Nothing secret or machine-specific may ship: env files, databases, keys.
  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const file = path.join(dir, entry);
      if (lstatSync(file).isDirectory()) walk(file);
      else if (/^\.env|\.db(-wal|-shm)?$|\.dump$|secret\.key$/.test(entry)) leaks.push(file);
    }
  };
  walk(server);
  if (leaks.length) throw new Error(`服务目录里有不该发布的文件：\n${leaks.join("\n")}`);
}

// ───────────────────────── 4. native binaries ─────────────────────────

const CANVAS_TARGETS: Record<string, string> = {
  "darwin-arm64": "@napi-rs/canvas-darwin-arm64",
  "darwin-x64": "@napi-rs/canvas-darwin-x64",
  "win32-x64": "@napi-rs/canvas-win32-x64-msvc",
};

/** `npm pack` verifies the tarball against the registry's integrity hash. */
function nativeFor(target: string) {
  const name = CANVAS_TARGETS[target];
  const version = JSON.parse(readFileSync(path.join(ROOT, "node_modules/@napi-rs/canvas/package.json"), "utf8")).version;
  const out = path.join(DIST, "native", target, ...name.split("/"));
  if (existsSync(path.join(out, "package.json"))) return;
  step(`下载 ${name}@${version}`);

  const cache = path.join(WORK, "cache", "npm", target);
  rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  execFileSync("npm", ["pack", `${name}@${version}`, "--silent", "--pack-destination", cache], { stdio: "inherit" });
  const tgz = readdirSync(cache).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack ${name} 没有产出文件`);
  mkdirSync(out, { recursive: true });
  execFileSync("tar", ["-xzf", path.join(cache, tgz), "-C", out, "--strip-components=1"], { stdio: "inherit" });
}

// ───────────────────────── 5. Windows toolchain ─────────────────────────

/** Everything the GESP judge needs from w64devkit: the C/C++ compiler and binutils. */
const KEEP_BIN = new Set(
  ["g++", "c++", "gcc", "cpp", "as", "ld", "ar", "ranlib", "nm", "strip", "objdump", "objcopy", "gcc-ar", "gcc-nm", "gcc-ranlib", "c++filt", "addr2line", "size", "strings", "windres", "dlltool"].map(
    (n) => `${n}.exe`,
  ),
);

const DROP_LIBS =
  /^lib(msvcr(80|90|100|110|120)d?(_app)?|msvcp(60|120_app)|ucrtbased|ucrtapp|icu|fastprox|netui[0-9]|wsmsvc|iis(rtl|util|ui)|windowsapp|onecore.*|windowscoreheadless_apiset|mincore|nanosrv|infocomm|framedyn|ntoskrnl|opcodes|bfd)\.a$/;

function prepareToolchain() {
  const target = path.join(WORK, "toolchain", "w64devkit");
  // Bump `prune` when the pruning below changes, so cached toolchains are rebuilt.
  const stamp = `${W64DEVKIT.version}+prune2`;
  const marker = path.join(target, "GESP-TOOLCHAIN.txt");
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === stamp) return;

  step(`准备 Windows 编译器 w64devkit ${W64DEVKIT.version}`);
  const dl = path.join(WORK, "cache", "w64devkit-dl");
  const archive = path.join(dl, W64DEVKIT.file);
  if (!existsSync(archive)) {
    mkdirSync(dl, { recursive: true });
    run("curl", ["-fL", "--retry", "3", "-o", archive, `https://github.com/skeeto/w64devkit/releases/download/v${W64DEVKIT.version}/${W64DEVKIT.file}`]);
  }
  const sha = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (sha !== W64DEVKIT.sha256) throw new Error(`${W64DEVKIT.file} 校验失败：${sha}`);

  const sevenZip = which(["7zz", "7z", "7za"]);
  if (!sevenZip) throw new Error("需要 7-Zip 解压 w64devkit（macOS：brew install sevenzip）");
  const extract = path.join(WORK, "cache", "w64devkit-x");
  rmSync(extract, { recursive: true, force: true });
  mkdirSync(extract, { recursive: true });
  execFileSync(sevenZip, ["x", "-y", `-o${extract}`, archive], { stdio: "ignore" });

  const kit = path.join(extract, "w64devkit");
  const gccVersion = readdirSync(path.join(kit, "lib", "gcc", "x86_64-w64-mingw32"))[0];
  // Fortran, 32-bit targets, cmake/gdb/vim/busybox and the sources are dead weight here.
  for (const rel of [
    "src",
    "share",
    "lib32",
    "etc",
    "w64devkit.exe",
    "w64devkit.ini",
    "Dockerfile",
    "lib/ccache",
    `lib/gcc/x86_64-w64-mingw32/${gccVersion}/32`,
    `lib/gcc/x86_64-w64-mingw32/${gccVersion}/finclude`,
    `lib/gcc/x86_64-w64-mingw32/${gccVersion}/libgfortran.a`,
    `lib/gcc/x86_64-w64-mingw32/${gccVersion}/libgfortran.spec`,
    `libexec/gcc/x86_64-w64-mingw32/${gccVersion}/f951.exe`,
  ])
    rmSync(path.join(kit, rel), { recursive: true, force: true });
  for (const f of readdirSync(path.join(kit, "bin"))) if (!KEEP_BIN.has(f)) rmSync(path.join(kit, "bin", f), { force: true });
  // The biggest import libraries are for things a console C++ program never links:
  // legacy/debug MSVC runtimes, OneCore/WinRT umbrella libs, IIS, binutils internals.
  // The defaults (mingw32, mingwex, msvcrt/ucrt, kernel32, user32, advapi32, …) stay.
  for (const f of readdirSync(path.join(kit, "lib")))
    if (DROP_LIBS.test(f)) rmSync(path.join(kit, "lib", f), { force: true });
  const gccLib = path.join(kit, "lib", "gcc", "x86_64-w64-mingw32", gccVersion);
  for (const f of readdirSync(gccLib)) if (/^libcaf_|^libgfortran/.test(f)) rmSync(path.join(gccLib, f), { force: true });

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(kit, target, { recursive: true });
  writeFileSync(marker, stamp + "\n");
  rmSync(extract, { recursive: true, force: true });
}

// ───────────────────────── 6. Electron app ─────────────────────────

async function assembleApp() {
  step("编译 Electron 主进程");
  const app = path.join(DIST, "app");
  rmSync(app, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  await esbuild({
    entryPoints: [path.join(ROOT, "desktop/main.ts")],
    outfile: path.join(app, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    logLevel: "warning",
  });
  writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify(
      {
        name: "gesp-learner",
        productName: "GESPLearner",
        version: pkg.version,
        description: "GESP 备考助手：CCF GESP C++ 真题练习、模拟考试、在线评测与 AI 讲解",
        author: { name: "DrWeiZhou", url: "https://github.com/DrWeiZhou/GESPLearner" },
        homepage: "https://github.com/DrWeiZhou/GESPLearner",
        license: "GPL-3.0",
        main: "main.cjs",
      },
      null,
      2,
    ),
  );
}

// ───────────────────────── 7. electron-builder ─────────────────────────

/** One run per platform: electron-builder's --arm64/--x64 flags apply to every platform in a run. */
function electronBuilder(platform: "--mac" | "--win", archs: string[]) {
  const argv = [
    "node_modules/electron-builder/cli.js",
    "--projectDir",
    "dist-desktop/app",
    "--config",
    path.join(ROOT, "desktop/electron-builder.cjs"),
    "--publish",
    "never",
    platform,
    ...archs.map((a) => `--${a}`),
  ];
  if (args.has("--dir")) argv.push("--dir");
  step(`electron-builder ${argv.slice(7).join(" ")}`);
  run("node", argv, { CSC_IDENTITY_AUTO_DISCOVERY: "false" });
}

// ───────────────────────── main ─────────────────────────

if (!wantMac && !wantWin && !args.has("--dev")) throw new Error("请指定 --mac 和/或 --win");
console.log(`GESPLearner ${pkg.version} · 目标：${[wantMac && `macOS (${macArchs.join(", ")})`, wantWin && "Windows (x64)"].filter(Boolean).join("、")}`);

if (!args.has("--skip-next")) nextBuild();
assembleServer();
if (wantMac) for (const arch of macArchs) nativeFor(`darwin-${arch}`);
if (wantWin) {
  nativeFor("win32-x64");
  prepareToolchain();
}
await assembleApp();

if (args.has("--dev")) {
  // Unpackaged run: main.cjs finds ../server; give it this machine's canvas binary.
  const target = `${process.platform}-${process.arch}`;
  if (CANVAS_TARGETS[target]) {
    nativeFor(target);
    cpSync(path.join(DIST, "native", target), path.join(DIST, "server", "node_modules"), { recursive: true });
  }
  step("用 Electron 打开 dist-desktop/app");
  run("bunx", ["electron", path.join(DIST, "app")]);
} else {
  if (wantMac) electronBuilder("--mac", macArchs);
  if (wantWin) electronBuilder("--win", ["x64"]);
  const release = path.join(DIST, "release");
  console.log("\n✓ 完成：");
  for (const f of readdirSync(release)) if (/\.(dmg|exe)$/.test(f)) console.log(`  ${path.join(release, f)}`);
}
