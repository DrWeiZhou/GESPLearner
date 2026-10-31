import { z } from "zod";
import { errorResponse, HttpError, requireAdmin } from "@/lib/auth";
import { judge0Runner } from "@/lib/judge/judge0";
import { createLocalRunner } from "@/lib/judge/local";
import { loadJudgeConfig } from "@/lib/judge/settings";

const Body = z.object({
  provider: z.enum(["local", "judge0"]),
  compilerPath: z.string().max(500).optional(),
  judge0Url: z.string().max(300).optional(),
  /** Blank = the saved key. */
  judge0Key: z.string().max(500).optional(),
});

// Uses <bits/stdc++.h> on purpose: it is what GESP solutions include, and the one
// header Apple clang lacks without the shim.
const PROGRAM = `#include <bits/stdc++.h>
using namespace std;
int main() {
    long long a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}
`;

/** Admin only: compile and run a+b with the form's values before saving them. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = Body.parse(await req.json());

    let runner;
    if (body.provider === "judge0") {
      const url = body.judge0Url?.trim();
      if (!url || !/^https?:\/\//.test(url)) throw new HttpError(400, "请填写以 http(s):// 开头的 Judge0 地址");
      let key = body.judge0Key?.trim();
      if (!key) {
        const current = await loadJudgeConfig().catch(() => null);
        if (current?.provider === "judge0") key = current.rapidApiKey ?? current.authToken;
      }
      runner = judge0Runner({
        url,
        ...(key ? (/rapidapi\.com/i.test(url) ? { rapidApiKey: key } : { authToken: key }) : {}),
        languageId: 54,
        compilerOptions: "-O2 -std=c++14",
        concurrency: 1,
      });
    } else {
      runner = createLocalRunner(body.compilerPath?.trim() || null);
    }

    const started = Date.now();
    const [r] = await runner.runMany(PROGRAM, ["20 26\n"], { timeLimitMs: 2000, memoryLimitMb: 256 });
    const elapsedMs = Date.now() - started;
    if (r.status === "OK" && r.stdout.trim() === "46") return Response.json({ ok: true, elapsedMs });
    const detail = (r.compileOutput || r.message || r.stderr || r.stdout || r.status).slice(0, 600);
    throw new HttpError(400, `测试失败（${r.status}）：${detail}`);
  } catch (err) {
    return errorResponse(err);
  }
}
