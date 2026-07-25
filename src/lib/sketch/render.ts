/**
 * Canvas output for the vector trace.
 *
 * Kept separate from `trace.ts` so the filter itself stays pure and testable
 * without a DOM.
 */

import { loopPath } from './vector';
import type { TraceResult } from './trace';

/** Upper bound on the rendered bitmap, so a phone never allocates a huge canvas. */
const MAX_OUTPUT_DIM = 1800;

export interface RenderOptions {
  /** Supersample factor relative to processing resolution. Default 2. */
  scale?: number;
  paper?: string;
  ink?: string;
}

/**
 * Draw a trace: solid ink on paper, one even-odd path.
 *
 * Even-odd is what makes holes work — a loop inside a loop is a hole, so eyes,
 * gaps and enclosed highlights come out right with no outer/inner bookkeeping.
 * Rendered above the processing resolution so the vector edges stay crisp when
 * the result is viewed or printed larger than the frame it was computed at.
 */
export function renderTraceToCanvas(
  result: TraceResult,
  canvas: HTMLCanvasElement,
  options: RenderOptions = {},
): void {
  const requested = options.scale ?? 2;
  const scale = Math.max(
    1,
    Math.min(requested, MAX_OUTPUT_DIM / Math.max(result.width, result.height)),
  );
  const W = Math.max(1, Math.round(result.width * scale));
  const H = Math.max(1, Math.round(result.height * scale));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = options.paper ?? '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (!result.loops.length) return;

  ctx.beginPath();
  for (const loop of result.loops) loopPath(loop, scale, ctx, result.settings.corners / 100);
  ctx.fillStyle = options.ink ?? '#000000';
  ctx.fill('evenodd');
}
