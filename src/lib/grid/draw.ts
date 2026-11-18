import type { GridSettings } from '@/types/project';
import { exportLineWidth, exportSize, gridLines, imageRect, type GridLines, type ImageRect } from './geometry';

// ─── Create a Grid: drawing ───────────────────────────────────────────────────
// The canvas calls of the preview, the saved grid image and the blank grid,
// in the order Create a Grid has always made them (draw.test.ts records them
// against the earlier code). Only a 2D context is needed, so it runs on any
// canvas.

/** Background of the preview and of the saved grid image. */
export const GRID_BACKGROUND = '#2a2a2a';
/** The blank grid is for paper: dark lines on white, whatever the lines' colour on the photo. */
export const BLANK_BACKGROUND = '#ffffff';
export const BLANK_LINE_COLOR = '#000000';

type Ctx = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'globalAlpha' | 'lineWidth' | 'fillRect' | 'save' | 'restore' | 'beginPath' | 'rect' | 'clip' | 'drawImage' | 'moveTo' | 'lineTo' | 'stroke' | 'strokeRect' | 'translate' | 'rotate'
>;

export function fillBackground(ctx: Ctx, w: number, h: number, color: string = GRID_BACKGROUND): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

/** The image, clipped to the canvas; a rotated one turns about its own centre. */
export function drawImageClipped(ctx: Ctx, img: CanvasImageSource, rect: ImageRect, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  if (rect.rotation === 0) {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  } else {
    ctx.translate(rect.x + rect.boundsW / 2, rect.y + rect.boundsH / 2);
    ctx.rotate((rect.rotation * Math.PI) / 180);
    ctx.drawImage(img, -rect.w / 2, -rect.h / 2, rect.w, rect.h);
  }
  ctx.restore();
}

/** Inner lines, then the border a little stronger. */
export function drawGridLines(ctx: Ctx, lines: GridLines, w: number, h: number, style: { color: string; opacity: number; width: number }): void {
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = style.opacity;
  ctx.lineWidth = style.width;
  for (const x of lines.xs) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (const y of lines.ys) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = Math.min(1, style.opacity + 0.3);
  ctx.strokeRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

export interface LoadedImage {
  source: CanvasImageSource;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * The saved grid image (2400 px wide): the background, the image if any,
 * then the grid. Or, `blank`, the same grid alone on white, for paper. The
 * canvas must already have the size from exportSize().
 */
export function drawExport(ctx: Ctx, gs: GridSettings, image: LoadedImage | null, options: { blank?: boolean } = {}): void {
  const { w, h } = exportSize(gs);
  const lines = gridLines(gs, w, h);
  const style = { color: gs.lineColor, opacity: gs.lineOpacity, width: exportLineWidth(gs, w) };
  if (options.blank) {
    fillBackground(ctx, w, h, BLANK_BACKGROUND);
    drawGridLines(ctx, lines, w, h, { ...style, color: BLANK_LINE_COLOR });
    return;
  }
  fillBackground(ctx, w, h);
  if (image) drawImageClipped(ctx, image.source, imageRect(gs, image.naturalWidth, image.naturalHeight, w / gs.canvasWidth, w, h), w, h);
  drawGridLines(ctx, lines, w, h, style);
}

/** The on-screen grid, at `scale` pixels per canvas unit on a `w × h` canvas (previewSize()). */
export function drawPreview(ctx: Ctx, gs: GridSettings, image: LoadedImage | null, size: { scale: number; w: number; h: number }): void {
  const { scale, w, h } = size;
  fillBackground(ctx, w, h);
  if (image) drawImageClipped(ctx, image.source, imageRect(gs, image.naturalWidth, image.naturalHeight, scale, w, h), w, h);
  drawGridLines(ctx, gridLines(gs, w, h), w, h, { color: gs.lineColor, opacity: gs.lineOpacity, width: gs.lineWidth });
}

/** File names of the saved images: as before for columns × rows; square cells name their size. */
export function exportFilename(gs: GridSettings, blank = false): string {
  const grid = gs.cellMode === 'square' ? `${gs.cellSize}${gs.unit}-squares` : `${gs.columns}x${gs.rows}`;
  return `grid-${blank ? 'blank-' : ''}${grid}-${gs.canvasWidth}x${gs.canvasHeight}${gs.unit}.png`;
}
