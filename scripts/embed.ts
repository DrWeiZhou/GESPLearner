/**
 * Generates question embeddings for pgvector similarity search.
 *
 *   bun scripts/embed.ts            # only questions without an embedding
 *   bun scripts/embed.ts --force    # re-embed everything
 */
import { embedQuestions } from "../src/lib/papers/seed";

const n = await embedQuestions({ force: process.argv.includes("--force"), log: console.log });
console.log(n === 0 ? "没有需要生成向量的题目" : "完成");
process.exit(0);
