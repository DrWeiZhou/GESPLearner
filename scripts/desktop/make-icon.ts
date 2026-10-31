/**
 * Draws the app icon — the `</>` mark from the site header on the brand blue — as
 * desktop/resources/icon.png (1024×1024). electron-builder turns it into .icns/.ico.
 *
 *   bun scripts/desktop/make-icon.ts
 */
import { writeFileSync } from "node:fs";
import { createCanvas, Path2D } from "@napi-rs/canvas";

const SIZE = 1024;

/** `tile`/`radius`: macOS wants a 824 px tile with a margin, Windows a full-bleed one. */
function draw(file: string, tile: number, radius: number, shadow: boolean) {
  const o = (SIZE - tile) / 2;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  if (shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 14;
  }
  const bg = ctx.createLinearGradient(0, o, 0, o + tile);
  bg.addColorStop(0, "#3a74f2");
  bg.addColorStop(1, "#1d4cc2");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(o, o, tile, tile, radius);
  ctx.fill();
  ctx.shadowColor = "transparent";

  // lucide "code-xml" (24×24 viewBox), scaled with the tile.
  const scale = (22 * tile) / 824;
  ctx.save();
  ctx.translate(SIZE / 2 - 12 * scale, SIZE / 2 - 12 * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of ["m18 16 4-4-4-4", "m6 8-4 4 4 4", "m14.5 4-5 16"]) ctx.stroke(new Path2D(d));
  ctx.restore();

  writeFileSync(file, canvas.toBuffer("image/png"));
  console.log(file);
}

draw("desktop/resources/icon.png", 824, 185, true);
draw("desktop/resources/icon-win.png", 1000, 190, false);
