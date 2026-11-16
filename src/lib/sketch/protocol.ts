/**
 * Messages between the page and the sketch worker.
 *
 * Pixels travel as transferred ArrayBuffers (moved, not copied). Results come
 * back as an encoded PNG when the worker can encode one itself
 * (OffscreenCanvas), otherwise as raw RGBA for the page to encode.
 */

import type { SketchControls, SketchStyle } from './styles';
import type { PathLayer } from './vector';

/** What the drawing shows: the drawing itself, or its lines in red over the photo. */
export type SketchView = 'drawing' | 'overlay';

export type SketchRequest =
  | {
      kind: 'load';
      /** Identifies the picture; later requests name it, so stale ones are refused. */
      imageId: number;
      width: number;
      height: number;
      /** RGBA, width × height × 4 bytes (transferred). */
      pixels: ArrayBuffer;
      /** Keep only the active style's caches (phones). */
      compact: boolean;
    }
  | { kind: 'render'; jobId: number; imageId: number; style: SketchStyle; controls: SketchControls; view: SketchView }
  | { kind: 'paths'; jobId: number; imageId: number; controls: SketchControls }
  | { kind: 'svg'; jobId: number; imageId: number; controls: SketchControls; width: number; height: number }
  /** A one-off Pencil Study at another size (for saving); nothing is cached. */
  | { kind: 'export'; jobId: number; width: number; height: number; pixels: ArrayBuffer; style: SketchStyle; controls: SketchControls }
  /** Free the caches (before a large export). With a jobId, the worker confirms once done. */
  | { kind: 'release'; jobId?: number };

export interface RenderTimings {
  /** Total milliseconds in the worker for this request. */
  total: number;
  /** Per stage, as measured by the pipeline. */
  stages: Record<string, number>;
  /** Bytes held by the engine after the request, and its peak during it. */
  heldBytes: number;
  peakBytes: number;
}

export type SketchResponse =
  | {
      kind: 'image';
      jobId: number;
      imageId: number;
      width: number;
      height: number;
      /** An encoded PNG, or raw RGBA pixels when the worker cannot encode. */
      png?: Blob;
      pixels?: ArrayBuffer;
      timings: RenderTimings;
    }
  | { kind: 'paths'; jobId: number; imageId: number; width: number; height: number; layers: PathLayer[]; timings: RenderTimings }
  | { kind: 'svg'; jobId: number; imageId: number; svg: string; timings: RenderTimings }
  | { kind: 'released'; jobId: number }
  | { kind: 'error'; jobId: number; message: string };
