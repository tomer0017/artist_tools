/**
 * The sketch worker's message handling, separate from the worker entry so it
 * can be tested without a browser.
 *
 * Requests are handled strictly one after another. The page sends at most one
 * render at a time and only the latest settings (see client.ts), so a slider
 * drag never builds a queue here.
 */

import { SketchPipeline } from './pipeline';
import type { RenderTimings, SketchRequest, SketchResponse } from './protocol';

export type Post = (message: SketchResponse, transfer?: Transferable[]) => void;
/** Encodes RGBA pixels as a PNG, or returns null when it cannot. */
export type Encoder = (pixels: Uint8ClampedArray, width: number, height: number) => Promise<Blob | null>;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** PNG encoding inside the worker, where the browser supports it (OffscreenCanvas). */
export function offscreenEncoder(): Encoder | null {
  try {
    if (typeof OffscreenCanvas !== 'function' || typeof ImageData !== 'function') return null;
    const probe = new OffscreenCanvas(1, 1);
    if (!probe.getContext('2d') || typeof probe.convertToBlob !== 'function') return null;
  } catch {
    return null;
  }
  let canvas: OffscreenCanvas | null = null;
  return async (pixels, width, height) => {
    if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    // A saved image is a one-off; do not keep its canvas around.
    if (width * height > 2_000_000) canvas = null;
    return blob;
  };
}

export function createSketchWorker(post: Post, encode: Encoder | null) {
  let pipeline: SketchPipeline | null = null;
  let imageId = -1;
  // Why the current picture could not be loaded, reported to its requests.
  let loadError: string | null = null;
  // The preview frame buffer is reused when PNGs are encoded here; otherwise
  // it is handed to the page and a new one is made next time.
  let frame: Uint8ClampedArray | null = null;
  let queue: Promise<void> = Promise.resolve();

  const timings = (t0: number, p: SketchPipeline): RenderTimings => {
    const s = p.stats();
    return { total: now() - t0, stages: s.timings, heldBytes: s.allocatedBytes, peakBytes: s.peakBytes };
  };

  async function sendImage(jobId: number, forImage: number, pixels: Uint8ClampedArray, width: number, height: number, t: RenderTimings, reusable: boolean) {
    const png = encode ? await encode(pixels, width, height) : null;
    if (png) {
      if (reusable) frame = pixels;
      post({ kind: 'image', jobId, imageId: forImage, width, height, png, timings: t });
    } else {
      if (reusable) frame = null;
      post({ kind: 'image', jobId, imageId: forImage, width, height, pixels: pixels.buffer as ArrayBuffer, timings: t }, [pixels.buffer as ArrayBuffer]);
    }
  }

  async function handle(req: SketchRequest): Promise<void> {
    if (req.kind === 'load') {
      pipeline?.release();
      pipeline = null;
      frame = null;
      imageId = req.imageId;
      loadError = null;
      try {
        pipeline = new SketchPipeline(new Uint8ClampedArray(req.pixels), req.width, req.height, req.compact);
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    if (req.kind === 'release') {
      pipeline?.release();
      frame = null;
      if (req.jobId !== undefined) post({ kind: 'released', jobId: req.jobId });
      return;
    }
    const t0 = now();
    try {
      if (req.kind === 'export') {
        const once = new SketchPipeline(new Uint8ClampedArray(req.pixels), req.width, req.height, true);
        const pixels = once.render(req.style, req.controls);
        const t = timings(t0, once);
        once.release();
        await sendImage(req.jobId, -1, pixels, req.width, req.height, t, false);
        return;
      }
      if (req.imageId === imageId && loadError) {
        post({ kind: 'error', jobId: req.jobId, message: loadError });
        return;
      }
      if (!pipeline || req.imageId !== imageId) {
        post({ kind: 'error', jobId: req.jobId, message: 'stale' });
        return;
      }
      const p = pipeline;
      if (req.kind === 'render') {
        const out = frame && frame.length === p.n * 4 ? frame : new Uint8ClampedArray(p.n * 4);
        if (req.view === 'overlay') p.overlay(req.style, req.controls, out);
        else p.render(req.style, req.controls, out);
        await sendImage(req.jobId, imageId, out, p.width, p.height, timings(t0, p), true);
      } else if (req.kind === 'paths') {
        const layers = p.outlinePaths(req.controls);
        post({ kind: 'paths', jobId: req.jobId, imageId, width: p.width, height: p.height, layers, timings: timings(t0, p) });
      } else if (req.kind === 'svg') {
        const svg = p.outlineSvg(req.controls, req.width, req.height);
        post({ kind: 'svg', jobId: req.jobId, imageId, svg, timings: timings(t0, p) });
      }
    } catch (error) {
      // Out of memory lands here too: drop the caches so the next attempt
      // starts from a clean slate.
      pipeline?.release();
      post({ kind: 'error', jobId: req.jobId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (req: SketchRequest): Promise<void> => {
    // A failure must never stall the requests behind it.
    queue = queue.then(() => handle(req)).catch((error) => console.error('[sketch worker]', error));
    return queue;
  };
}
