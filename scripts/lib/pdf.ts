import { getDocumentProxy, renderPageAsImage } from "unpdf";

type TextItem = { str: string; transform: number[] };

/**
 * Extracts text page by page in reading order (top→bottom, left→right).
 * pdf.js returns items in content-stream order, which for GESP papers interleaves
 * question stems and options, so we re-sort by coordinates.
 *
 * NOTE: GESP papers render math as vector paths, so formulas are missing from
 * this text — page images are needed for an exact transcription.
 */
export async function extractPagesText(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(data.slice());
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items as TextItem[])
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const lines: string[] = [];
    let lastY: number | null = null;
    let line: string[] = [];
    for (const it of items) {
      if (lastY !== null && Math.abs(it.y - lastY) > 3) {
        lines.push(line.join(" "));
        line = [];
      }
      line.push(it.s);
      lastY = it.y;
    }
    if (line.length) lines.push(line.join(" "));
    pages.push(lines.join("\n"));
  }
  return pages;
}

export async function renderPages(data: Uint8Array, scale = 1.5): Promise<Uint8Array[]> {
  const pdf = await getDocumentProxy(data.slice());
  const images: Uint8Array[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const png = await renderPageAsImage(data.slice(), i, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale,
    });
    images.push(new Uint8Array(png));
  }
  return images;
}
