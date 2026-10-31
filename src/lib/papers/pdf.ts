import "server-only";
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

/**
 * Where the 判断题 answer table sits: its page, and the band from the 题号 row to the
 * 答案 row in PDF points measured from the top. The √/× marks are vector paths with
 * no text, but both row labels are text, so the text layer can find the table.
 */
export async function findTrueFalseTable(
  data: Uint8Array,
): Promise<{ page: number; top: number; bottom: number } | null> {
  const pdf = await getDocumentProxy(data.slice());
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const height = page.getViewport({ scale: 1 }).height;
    const items = ((await page.getTextContent()).items as TextItem[])
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      // Newer papers space the labels out ("题 号").
      .map((it) => ({ s: it.str.replace(/\s+/g, ""), y: height - it.transform[5] }))
      .sort((a, b) => a.y - b.y);
    const heading = items.find((it) => it.s.includes("判断题"));
    if (!heading) continue;
    const header = items.find((it) => it.s.startsWith("题号") && it.y > heading.y);
    const answers = items.find((it) => it.s.startsWith("答案") && header && it.y > header.y);
    if (!header || !answers) return null;
    // √ hangs well below the baseline of the 答案 label.
    return { page: i, top: header.y - 14, bottom: answers.y + 16 };
  }
  return null;
}

/** Renders the band `top`…`bottom` (PDF points from the top) of one page as a PNG. */
export async function renderBand(data: Uint8Array, pageNumber: number, top: number, bottom: number, scale = 4) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const png = await renderPageAsImage(data.slice(), pageNumber, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale,
  });
  const image = await loadImage(Buffer.from(png));
  const y = Math.max(0, Math.floor(top * scale));
  const h = Math.min(image.height - y, Math.ceil((bottom - top) * scale));
  const canvas = createCanvas(image.width, h);
  canvas.getContext("2d").drawImage(image, 0, y, image.width, h, 0, 0, image.width, h);
  return new Uint8Array(canvas.toBuffer("image/png"));
}
