/**
 * Generates hidden test cases for programming questions, so submissions are judged
 * on more than the two printed samples.
 *
 *   bun scripts/gen-tests.ts cpp-2026-09-l3           # one paper
 *   bun scripts/gen-tests.ts --all [--force]
 *
 * Method: an LLM writes a small C++ input generator (seeded from stdin),
 * we compile it together with the official reference solution, then record
 * generator output → reference output as `data/tests/<questionId>.json`.
 * Cases are only kept when the reference solution runs cleanly, so a bad generator
 * degrades to "samples only" rather than producing wrong expected answers.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel } from "../src/lib/ai/model";
import { normalizeOutput } from "../src/lib/judge";
import { localRunner } from "../src/lib/judge/local";
import { PaperSchema, questionId } from "../src/lib/schema/paper";

const DATA_DIR = path.join(process.cwd(), "data");
const COUNT = Number(process.env.GEN_TEST_COUNT ?? 8);

const SYSTEM = `你是竞赛题目的数据生成专家。请为给定题目写一个 C++ 随机数据生成器。

要求：
1. 只输出完整的 C++ 源码，不要解释、不要 Markdown 围栏。
2. 程序先从标准输入读取一个整数种子：int seed; cin >> seed; srand(seed); —— 同一种子必须产生完全相同的输出。
3. 向标准输出打印一组**合法**输入数据，格式必须与题目的输入格式完全一致。
4. 数据规模要覆盖不同情况：种子较小时生成小数据和边界情况（最小值、相等、极端分布），种子较大时接近题目数据范围的上限。
5. 生成的数据必须满足题面所有约束，不要越界。`;

const stripFence = (s: string) => {
  const m = s.match(/```(?:cpp|c\+\+)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : s).trim();
};

type Question = { id: string; title: string; description: string; inputFormat: string; outputFormat: string; dataRange?: string; samples: { input: string; output: string }[]; referenceSolution?: string; timeLimitMs: number; memoryLimitMb: number };

async function generateFor(q: Question) {
  if (!q.referenceSolution) return null;

  const prompt = `题目：${q.title}

${q.description}

输入格式：
${q.inputFormat}

输出格式：
${q.outputFormat}

${q.dataRange ? `数据范围：${q.dataRange}` : ""}

样例输入：
${q.samples[0]?.input ?? ""}`;

  const res = await (await getChatModel({ temperature: 0.2 })).invoke([new SystemMessage(SYSTEM), new HumanMessage(prompt)]);
  const generator = stripFence(res.text);

  // The generator reads its seed from stdin, so one compile + one run per seed.
  const seeds = Array.from({ length: COUNT }, (_, i) => `${i + 1}\n`);
  const genRuns = await localRunner.runMany(generator, seeds, { timeLimitMs: 10_000, memoryLimitMb: 512 });
  if (genRuns[0]?.status === "CE") return { error: `生成器编译失败：${genRuns[0].compileOutput.slice(0, 300)}` };

  const inputs = genRuns.filter((r) => r.status === "OK" && r.stdout.trim()).map((r) => r.stdout);
  if (inputs.length === 0) return { error: "生成器没有输出数据" };

  // Run the samples through the reference solution too. Expected outputs for hidden
  // cases are only as trustworthy as that program, so if it can't reproduce the
  // official sample outputs (a transcription error, say) we keep no generated data.
  const sampleInputs = q.samples.map((s) => s.input);
  const refRuns = await localRunner.runMany(q.referenceSolution, [...sampleInputs, ...inputs], {
    timeLimitMs: Math.max(q.timeLimitMs * 3, 5000),
    memoryLimitMb: q.memoryLimitMb,
  });
  if (refRuns[0]?.status === "CE") return { error: `参考程序编译失败：${refRuns[0].compileOutput.slice(0, 300)}` };

  for (const [i, sample] of q.samples.entries()) {
    const run = refRuns[i];
    if (run?.status !== "OK" || normalizeOutput(run.stdout) !== normalizeOutput(sample.output))
      return { error: `参考程序未能复现样例 ${i + 1}，已跳过（请检查该题的 referenceSolution）` };
  }

  const cases = q.samples.map((s, idx) => ({ idx, input: s.input, expectedOutput: s.output, isSample: true }));
  let idx = cases.length;
  for (const [i, input] of inputs.entries()) {
    const run = refRuns[sampleInputs.length + i];
    if (run?.status !== "OK") continue;
    cases.push({ idx: idx++, input, expectedOutput: normalizeOutput(run.stdout), isSample: false });
  }
  return { cases };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const ids = args.filter((a) => a.startsWith("cpp-"));
  const all = args.includes("--all");
  if (!all && ids.length === 0) {
    console.error("用法：bun scripts/gen-tests.ts <paperId...> | --all [--force]");
    process.exit(1);
  }

  const dir = path.join(DATA_DIR, "papers");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && (all || ids.includes(f.replace(/\.json$/, ""))));
  await mkdir(path.join(DATA_DIR, "tests"), { recursive: true });

  for (const file of files) {
    const paper = PaperSchema.parse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
    for (const q of paper.questions) {
      if (q.type !== "programming") continue;
      const id = questionId(paper.id, q);
      const out = path.join(DATA_DIR, "tests", `${id}.json`);
      if (!force && (await Bun.file(out).exists())) continue;

      process.stdout.write(`${id}《${q.title}》… `);
      const result = await generateFor({ ...q, id });
      if (!result) {
        console.log("跳过（没有参考程序）");
        continue;
      }
      if ("error" in result) {
        console.log(`✗ ${result.error}`);
        continue;
      }
      await writeFile(out, JSON.stringify(result.cases, null, 2) + "\n");
      console.log(`✓ ${result.cases.length} 个测试点（含 ${q.samples.length} 个样例）`);
    }
  }
}

await main();
// the settings lookup may have opened a database connection
process.exit(0);
