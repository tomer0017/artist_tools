/**
 * Sketch engine — drawing the strokes.
 *
 * Kept separate from the analysis so the pipeline stays testable without a
 * canvas, and so a future style can change how strokes are *drawn* without
 * touching how they were chosen.
 */

import { loopPath } from './vector';
import { WEIGHT_ORDER, type LineWeight, type SketchDrawing, type SketchStroke } from './types';

/** Upper bound on the rendered bitmap, so a phone never allocates a huge canvas. */
const MAX_OUTPUT_DIM = 1800;
/** Ceiling on shading alpha — pencil tone should support the line, never fight it. */
const SHADING_MAX_ALPHA = 0.26;

export interface RenderOptions {
  /** Supersample factor relative to processing resolution. Default 2. */
  scale?: number;
}

export function renderSketchToCanvas(
  drawing: SketchDrawing,
  canvas: HTMLCanvasElement,
  options: RenderOptions = {},
): void {
  const requested = options.scale ?? 2;
  const scale = Math.max(
    1,
    Math.min(requested, MAX_OUTPUT_DIM / Math.max(drawing.width, drawing.height)),
  );
  const W = Math.max(1, Math.round(drawing.width * scale));
  const H = Math.max(1, Math.round(drawing.height * scale));

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = drawing.paper;
  ctx.fillRect(0, 0, W, H);

  if (drawing.shading) drawShading(ctx, drawing, W, H);

  // Filled masses first — the drawing *is* the masses in a trace style; the
  // outlines that follow only firm up the silhouette. One path, even-odd, so
  // every enclosed loop becomes a hole (eyes, gaps, catchlights) for free.
  if (drawing.shapes && drawing.shapes.loops.length) {
    ctx.beginPath();
    for (const loop of drawing.shapes.loops) loopPath(loop, scale, ctx);
    ctx.fillStyle = drawing.ink;
    ctx.fill('evenodd');
  }

  // Each weight class is drawn opaque onto a scratch layer and then composited
  // at its own alpha. Drawing directly at alpha would darken every crossing and
  // every internal seam of a tapered stroke; this way a class is uniformly
  // weighted no matter how many lines overlap.
  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;

  const byClass = groupByWeight(drawing.strokes);
  for (const weight of WEIGHT_ORDER) {
    const group = byClass[weight];
    if (!group.length) continue;
    sctx.clearRect(0, 0, W, H);
    sctx.strokeStyle = drawing.ink;
    sctx.lineCap = 'round';
    sctx.lineJoin = 'round';
    for (const stroke of group) drawStroke(sctx, stroke, scale);
    ctx.globalAlpha = drawing.opacity[weight];
    ctx.drawImage(scratch, 0, 0);
  }
  ctx.globalAlpha = 1;
}

function groupByWeight(strokes: SketchStroke[]): Record<LineWeight, SketchStroke[]> {
  const out: Record<LineWeight, SketchStroke[]> = { heavy: [], medium: [], light: [] };
  for (const s of strokes) out[s.weightClass].push(s);
  return out;
}

/**
 * A stroke is split into runs of equal quantised width, each drawn as one
 * smooth path. Runs overlap by a point so the line reads continuous.
 */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: SketchStroke, scale: number) {
  const n = stroke.points.length / 2;
  if (n < 2) return;
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    q[i] = Math.max(0.4, Math.round(stroke.widths[i] * scale * 4) / 4);
  }
  let i = 0;
  while (i < n - 1) {
    let j = i;
    while (j + 1 < n && q[j + 1] === q[i]) j++;
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, j + 1);
    drawRun(ctx, stroke.points, a, b, q[i], scale);
    i = j + 1;
  }
}

/**
 * Quadratic segments through point midpoints — the standard way to get a
 * flowing hand-drawn line out of a simplified polyline while still honouring
 * genuine corners.
 */
function drawRun(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  a: number,
  b: number,
  width: number,
  scale: number,
) {
  if (b <= a) return;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[a * 2] * scale, pts[a * 2 + 1] * scale);
  if (b - a === 1) {
    ctx.lineTo(pts[b * 2] * scale, pts[b * 2 + 1] * scale);
  } else {
    for (let k = a + 1; k < b; k++) {
      const cx = pts[k * 2] * scale;
      const cy = pts[k * 2 + 1] * scale;
      const mx = (cx + pts[(k + 1) * 2] * scale) / 2;
      const my = (cy + pts[(k + 1) * 2 + 1] * scale) / 2;
      ctx.quadraticCurveTo(cx, cy, mx, my);
    }
    ctx.lineTo(pts[b * 2] * scale, pts[b * 2 + 1] * scale);
  }
  ctx.stroke();
}

function drawShading(
  ctx: CanvasRenderingContext2D,
  drawing: SketchDrawing,
  W: number,
  H: number,
) {
  const shading = drawing.shading!;
  const { width: tw, height: th, tone, hatch } = shading;
  const off = document.createElement('canvas');
  off.width = tw;
  off.height = th;
  const octx = off.getContext('2d');
  if (!octx) return;
  const img = octx.createImageData(tw, th);
  const data = img.data;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const p = y * tw + x;
      const t = tone[p];
      if (t <= 0) continue;
      // Diagonal modulation reads as pencil laid down at an angle rather than
      // a flat grey wash.
      const stripe = 0.5 + 0.5 * Math.sin((x + y) * 0.9);
      const alpha = t * (1 - hatch + hatch * stripe) * SHADING_MAX_ALPHA;
      const i = p * 4;
      data[i] = 42;
      data[i + 1] = 42;
      data[i + 2] = 48;
      data[i + 3] = Math.round(255 * Math.min(1, alpha));
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, W, H);
}
