/**
 * Downloads the official GESP syllabus（认证资料 → 认证大纲）, parses each C++ level
 * with the vision model and writes `data/syllabus/l<N>.json`, then imports it.
 *
 *   bun scripts/syllabus.ts            # every level
 *   bun scripts/syllabus.ts 3 5        # only 三级 and 五级
 *   bun scripts/syllabus.ts --reuse    # re-seed from the existing JSON, no model call
 *   bun scripts/syllabus.ts --no-seed  # only write the JSON (no DATABASE_URL needed)
 *
 * The PDF covers all eight levels, so it is downloaded and rendered once.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadPdf } from "../src/lib/papers/official";
import { SyllabusSchema, type Syllabus } from "../src/lib/schema/syllabus";
import { fetchSyllabusSource } from "../src/lib/syllabus/official";
import { parseSyllabusLevel, readSyllabusPdf, type SyllabusPdf } from "../src/lib/syllabus/parse";
import { seedSyllabus } from "../src/lib/syllabus/seed";

const DATA_DIR = path.join(process.cwd(), "data", "syllabus");
const fileOf = (level: number) => path.join(DATA_DIR, `l${level}.json`);

async function loadJson(level: number): Promise<Syllabus | null> {
  try {
    return SyllabusSchema.parse(JSON.parse(await readFile(fileOf(level), "utf8")));
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reuse = args.includes("--reuse");
  const seed = !args.includes("--no-seed");
  const only = args.filter((a) => /^[1-8]$/.test(a)).map(Number);

  await mkdir(DATA_DIR, { recursive: true });

  const source = await fetchSyllabusSource(console.log);
  console.log(`大纲 PDF：${source.pdfUrl}`);

  // With --reuse nothing is parsed, so the PDF is only fetched when it's needed.
  let pdf: SyllabusPdf | null = null;
  const levels = only.length ? only : [1, 2, 3, 4, 5, 6, 7, 8];
  if (!reuse) {
    pdf = await readSyllabusPdf(await downloadPdf(source.pdfUrl));
    console.log(`章节：${pdf.sections.map((s) => `${s.level}级 p${s.from}-${s.to}`).join("、")}`);
  }

  let ok = 0;
  for (const level of levels) {
    try {
      let syllabus = reuse ? await loadJson(level) : null;
      if (reuse && !syllabus) {
        console.warn(`跳过 ${level} 级：data/syllabus/l${level}.json 不存在`);
        continue;
      }
      if (!syllabus) {
        syllabus = await parseSyllabusLevel(level, pdf!, source);
        await writeFile(fileOf(level), JSON.stringify(syllabus, null, 2) + "\n");
        console.log(`写入 data/syllabus/l${level}.json：${syllabus.points.length} 个知识点`);
      }
      if (seed) {
        const points = await seedSyllabus(syllabus);
        console.log(`✓ ${level} 级：${points} 个知识点已入库`);
      }
      ok++;
    } catch (err) {
      console.error(`✗ ${level} 级：${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`完成：${ok}/${levels.length} 个级别`);
  // `listSyllabi` is cached for hours and tagged; the admin import route drops that
  // tag afterwards, but a CLI run happens outside the Next runtime and can't. So a
  // deployed /syllabus keeps serving whatever it had — including the "not imported
  // yet" card baked into its prerendered shell.
  if (seed && ok > 0)
    console.log("提示：线上 /syllabus 列表缓存若干小时，重新部署或在「系统设置 → 考试大纲」导入一次才会立刻刷新。");
}

await main();
