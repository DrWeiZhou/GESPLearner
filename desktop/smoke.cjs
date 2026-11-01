/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script run by Electron-as-Node */
/**
 * Smoke test for an installed desktop app, run with the app's own Electron as Node:
 *
 *   ELECTRON_RUN_AS_NODE=1 <GESPLearner.exe | …/MacOS/GESPLearner> desktop/smoke.cjs <install dir | .app>
 *
 * Boots the bundled server against a fresh data folder whose path contains Chinese
 * characters, then checks: database bootstrap, pages, compiler detection, running
 * and judging C++ (with the toolchain shipped in the installer on Windows),
 * grading + coins, backups — and finally that the GUI app starts its own server.
 * Used by .github/workflows/desktop-smoke.yml on a Windows runner.
 */
const { spawn, execFileSync } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const target = path.resolve(process.argv[2] ?? "");
const isWin = process.platform === "win32";
const exe = isWin ? path.join(target, "GESPLearner.exe") : path.join(target, "Contents", "MacOS", "GESPLearner");
const resources = isWin ? path.join(target, "resources") : path.join(target, "Contents", "Resources");
const serverDir = path.join(resources, "server");
const toolchain = path.join(resources, "toolchain", "w64devkit");
const PORT = 47_990;
const base = `http://127.0.0.1:${PORT}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "GESP测试-"));
const results = [];
let failed = false;

function check(name, ok, detail = "") {
  results.push(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(results.at(-1));
  if (!ok) failed = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const body = await res.json();
      if (body.ok) return body;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return null;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWin) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // already gone
    }
  } else child.kill("SIGTERM");
}

async function main() {
  check("app files", fs.existsSync(exe) && fs.existsSync(path.join(serverDir, "server.js")), exe);
  if (isWin) check("bundled g++", fs.existsSync(path.join(toolchain, "bin", "g++.exe")));

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    GESP_DESKTOP: "1",
    GESP_AUTO_BACKUP: "1",
    GESP_DB_PATH: path.join(dataDir, "gesp.db"),
    JUDGE_PROVIDER: "local",
    // A temp folder with Chinese characters, like a Windows user named 张三 has.
    TEMP: dataDir,
    TMP: dataDir,
    TMPDIR: dataDir,
  };
  if (fs.existsSync(toolchain)) env.GESP_TOOLCHAIN_DIR = toolchain;
  // Like the real app (desktop/main.ts passes no CXX), so the bundled GCC is what gets tested.
  delete env.CXX;

  const log = fs.openSync(path.join(dataDir, "server.log"), "a");
  const server = spawn(exe, [path.join(serverDir, "server.js")], { cwd: serverDir, env, stdio: ["ignore", log, log] });
  try {
    const started = Date.now();
    const health = await waitHealth(`${base}/api/health`, 180_000);
    check("server boots and imports the question bank", health?.papers === 106, `${health?.papers} papers in ${Date.now() - started} ms`);
    if (!health) return;

    // An admin with a session, written straight into the database.
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(env.GESP_DB_PATH, { timeout: 10_000 });
    const userId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    db.prepare("insert into users (id, username, password_hash, display_name, role, created_at, failed_attempts) values (?, 'smoke', 'x', '测试', 'admin', ?, 0)").run(userId, now);
    db.prepare("insert into sessions (id, user_id, token_hash, expires_at, created_at) values (?, ?, ?, ?, ?)").run(randomUUID(), userId, createHash("sha256").update(token).digest("hex"), now + 86_400_000, now);
    db.close();
    const headers = { "content-type": "application/json", cookie: `gesp_session=${token}` };
    const post = async (url, body) => {
      const res = await fetch(base + url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    for (const page of ["/", "/papers", "/papers/cpp-2025-09-l3", "/practice/cpp-2025-09-l3-pg-01", "/syllabus/3", "/admin", "/wrong-book", "/monaco/vs/loader.js"]) {
      const res = await fetch(base + page, { headers });
      check(`GET ${page}`, res.status === 200, String(res.status));
    }

    const judge = await (await fetch(`${base}/api/settings/judge`, { headers })).json();
    check(
      isWin ? "bundled compiler in use" : "compiler detected",
      Boolean(judge.compiler) && (!isWin || judge.compiler.source === "bundled"),
      judge.compiler ? `${judge.compiler.version} (${judge.compiler.source}) ${judge.compiler.path}` : judge.compilerHint,
    );

    // bits/stdc++.h plus recursion a million frames deep: Windows' default 1 MB stack would overflow.
    const program = `#include <bits/stdc++.h>
using namespace std;
long long depth(int n) { return n == 0 ? 0 : 1 + depth(n - 1); }
int main() { long long a, b; cin >> a >> b; cout << a + b << " " << depth(1000000) << endl; return 0; }
`;
    const run = await post("/api/run", { code: program, stdin: "20 26\n" });
    check("run C++ (bits/stdc++.h, deep recursion)", run.body?.stdout?.trim() === "46 1000000", JSON.stringify(run.body).slice(0, 400));

    const ce = await post("/api/run", { code: "int main( { return 0; }", stdin: "" });
    check("compile error reported", ce.body?.status === "CE", ce.body?.status);

    const paper = JSON.parse(fs.readFileSync(path.join(serverDir, "data", "papers", "cpp-2025-09-l3.json"), "utf8"));
    const pg = paper.questions.find((q) => q.type === "programming");
    const submit = await post("/api/submit", { questionId: "cpp-2025-09-l3-pg-01", code: pg.referenceSolution });
    check("submit reference solution", submit.body?.verdict === "AC", `${submit.body?.verdict} ${submit.body?.passed}/${submit.body?.total}, +${submit.body?.reward?.coins} 金币`);

    const sc = paper.questions.find((q) => q.type === "single_choice");
    const answer = await post("/api/answers/check", { questionId: "cpp-2025-09-l3-sc-01", answer: sc.answer });
    check("grade an objective question", answer.body?.correct === true && answer.body?.reward?.coins > 0, JSON.stringify(answer.body?.reward));

    const backup = await post("/api/admin/backup", {});
    check("manual backup", backup.status === 200 && fs.existsSync(path.join(dataDir, "backups", backup.body?.name ?? "-")), backup.body?.name);
    const autos = fs.readdirSync(path.join(dataDir, "backups")).filter((f) => f.endsWith("-auto.db"));
    check("daily automatic backup", autos.length === 1, autos[0]);
  } finally {
    killTree(server);
    await sleep(1500);
  }

  // The real app: Electron main process → utility process → server on its fixed port.
  const guiEnv = { ...process.env };
  delete guiEnv.ELECTRON_RUN_AS_NODE;
  const gui = spawn(exe, [], { env: guiEnv, stdio: "ignore", detached: !isWin });
  try {
    const health = await waitHealth("http://127.0.0.1:47831/api/health", 180_000);
    check("GUI app starts its server", health?.ok === true, JSON.stringify(health));
  } finally {
    killTree(gui);
    if (!isWin) {
      try {
        process.kill(-gui.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
}

main()
  .catch((err) => check("smoke test crashed", false, err?.stack ?? String(err)))
  .finally(() => {
    const log = path.join(dataDir, "server.log");
    if (failed && fs.existsSync(log)) console.log(`\n── server.log ──\n${fs.readFileSync(log, "utf8").slice(-6000)}`);
    console.log(`\n${failed ? "FAILED" : "PASSED"} · ${results.filter((r) => r.startsWith("✓")).length}/${results.length}`);
    process.exit(failed ? 1 : 0);
  });
