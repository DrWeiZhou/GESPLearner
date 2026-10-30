/**
 * Generates question embeddings for pgvector similarity search.
 *
 *   bun scripts/embed.ts            # only questions without an embedding
 *   bun scripts/embed.ts --force    # re-embed everything
 */
import { isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { EMBEDDING_DIMENSIONS, questions } from "../src/db/schema";
import { getEmbeddings } from "../src/lib/ai/model";

/** Strip Markdown/LaTeX noise so the vector reflects the actual wording. */
function toText(q: typeof questions.$inferSelect) {
  const parts = [q.title, q.stem, ...(q.options ?? []).map((o) => o.content), q.inputFormat, q.outputFormat, q.dataRange];
  return parts
    .filter(Boolean)
    .join("\n")
    .replace(/```[\s\S]*?```/g, " [代码] ")
    .replace(/[#*`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

const force = process.argv.includes("--force");
const db = getDb();
const rows = await db.select().from(questions).where(force ? undefined : isNull(questions.embedding));
if (rows.length === 0) {
  console.log("没有需要生成向量的题目");
  process.exit(0);
}

const embeddings = getEmbeddings(EMBEDDING_DIMENSIONS);
const BATCH = 16;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const vectors = await embeddings.embedDocuments(batch.map(toText));
  await db.transaction(async (tx) => {
    for (const [j, row] of batch.entries())
      await tx.update(questions).set({ embedding: vectors[j] }).where(eq(questions.id, row.id));
  });
  console.log(`已生成 ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
}
console.log("完成");
process.exit(0);
