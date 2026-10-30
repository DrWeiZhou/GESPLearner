/**
 * Debug helper: dump a GESP PDF as page PNGs + reading-order text.
 *
 *   bun scripts/render-pdf.ts <file.pdf> <outDir>
 */
import { mkdir } from "node:fs/promises";
import { extractPagesText, renderPages } from "./lib/pdf";

const [file, outDir] = process.argv.slice(2);
if (!file || !outDir) {
  console.error("usage: bun scripts/render-pdf.ts <file.pdf> <outDir>");
  process.exit(1);
}

const data = new Uint8Array(await Bun.file(file).arrayBuffer());
await mkdir(outDir, { recursive: true });

const images = await renderPages(data);
for (const [i, png] of images.entries()) await Bun.write(`${outDir}/p${i + 1}.png`, png);

const texts = await extractPagesText(data);
await Bun.write(
  `${outDir}/text.txt`,
  texts.map((t, i) => `===== page ${i + 1} =====\n${t}`).join("\n\n"),
);
console.log(`wrote ${images.length} pages to ${outDir}`);
