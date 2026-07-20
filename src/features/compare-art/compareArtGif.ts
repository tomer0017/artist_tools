// Compare Art — animated GIF export.
//
// Two halves:
//  1. buildGifFrameSpecs() — a PURE description of the frame sequence (unit
//     tested). It never touches the DOM.
//  2. generateComparisonGif() — renders each spec through the SAME canonical
//     renderer used on screen, quantises with gifenc and encodes, yielding to
//     the browser between frames so the UI never freezes, with progress +
//     cancellation.

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  CropRect,
  GifAnimation,
  GifSpeed,
  GridConfig,
  Transform,
  GIF_FRAME_DELAY_MS,
} from './compareArtTypes';
import { Size } from './compareArtGeometry';
import {
  PreparedImage,
  SceneInputs,
  applyCrop,
  renderSceneToCanvas,
} from './compareArtCanvas';

/** A resolution-independent description of one GIF frame. */
export type GifFrameSpec =
  | { kind: 'opacity'; opacity: number }
  | { kind: 'only'; only: 'artwork' | 'reference' }
  | { kind: 'diff' };

/** Default opacity-pulse ramp: 0→100→0. First and last match for a clean loop. */
export const OPACITY_PULSE_STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1, 0.8, 0.6, 0.4, 0.2, 0];

/**
 * Build the pure frame sequence for an animation style. Deterministic and
 * DOM-free so the ordering guarantees (e.g. "reference geometry never changes")
 * can be verified in tests.
 */
export function buildGifFrameSpecs(animation: GifAnimation): GifFrameSpec[] {
  switch (animation) {
    case 'opacity-pulse':
      return OPACITY_PULSE_STOPS.map((opacity) => ({ kind: 'opacity', opacity }));
    case 'blink':
      return [
        { kind: 'only', only: 'artwork' },
        { kind: 'only', only: 'reference' },
        { kind: 'only', only: 'artwork' },
        { kind: 'only', only: 'reference' },
      ];
    case 'compare-diff':
      return [
        { kind: 'only', only: 'artwork' },
        { kind: 'only', only: 'reference' },
        { kind: 'opacity', opacity: 0.5 },
        { kind: 'diff' },
        { kind: 'opacity', opacity: 0.5 },
        { kind: 'only', only: 'artwork' },
      ];
    default:
      return [{ kind: 'opacity', opacity: 0.5 }];
  }
}

export interface GifRenderParams {
  artwork: PreparedImage;
  reference: PreparedImage;
  artworkTransform: Transform;
  referenceTransform: Transform;
  crop: CropRect;
  scene: Size; // full scene size (export resolution, pre-crop)
  grid: GridConfig;
  includeGrid: boolean;
  grayscale: boolean;
  animation: GifAnimation;
  speed: GifSpeed;
  loop: boolean;
  /** Pre-computed difference overlay for 'diff' frames (RGBA). */
  differenceOverlay?: { data: Uint8ClampedArray; width: number; height: number } | null;
}

export interface GifProgress {
  phase: 'frames' | 'encoding' | 'done';
  current: number;
  total: number;
}

export interface GifHandle {
  cancel: () => void;
  promise: Promise<Blob>;
}

class CancelledError extends Error {
  constructor() {
    super('GIF generation cancelled');
    this.name = 'CancelledError';
  }
}

/** Convert one frame spec into the SceneInputs frame override. */
function specToInputs(
  spec: GifFrameSpec,
  base: Omit<SceneInputs, 'frame'>,
): SceneInputs {
  if (spec.kind === 'only') return { ...base, frame: { only: spec.only } };
  if (spec.kind === 'diff') return { ...base, frame: { showDifference: true } };
  return { ...base, frame: { opacity: spec.opacity } };
}

/**
 * Render + encode an animated GIF on the main thread, chunked so the UI stays
 * responsive. Returns a handle exposing the result promise and a cancel().
 */
export function generateComparisonGif(
  params: GifRenderParams,
  onProgress?: (p: GifProgress) => void,
): GifHandle {
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  const promise = (async (): Promise<Blob> => {
    const specs = buildGifFrameSpecs(params.animation);
    const delay = GIF_FRAME_DELAY_MS[params.speed];
    const gif = GIFEncoder();

    const base: Omit<SceneInputs, 'frame'> = {
      artwork: params.artwork,
      reference: params.reference,
      scene: params.scene,
      artworkTransform: params.artworkTransform,
      referenceTransform: params.referenceTransform,
      opacity: 0.5,
      mode: 'overlay',
      grayscale: params.grayscale,
      referenceHidden: false,
      splitOrientation: 'horizontal',
      splitPosition: 0.5,
      grid: params.grid,
      includeGrid: params.includeGrid,
      differenceOverlay: params.differenceOverlay ?? null,
    };

    let width = 0;
    let height = 0;

    for (let i = 0; i < specs.length; i++) {
      if (cancelled) throw new CancelledError();
      onProgress?.({ phase: 'frames', current: i, total: specs.length });

      const sceneCanvas = renderSceneToCanvas(specToInputs(specs[i], base));
      const frameCanvas = applyCrop(sceneCanvas, params.crop);
      width = frameCanvas.width;
      height = frameCanvas.height;
      const ctx = frameCanvas.getContext('2d');
      if (!ctx) continue;
      const { data } = ctx.getImageData(0, 0, width, height);

      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, width, height, {
        palette,
        delay,
        repeat: params.loop ? 0 : -1,
      });

      // Yield to the event loop so the UI can paint / accept the cancel button.
      await new Promise((r) => setTimeout(r, 0));
    }

    if (cancelled) throw new CancelledError();
    onProgress?.({ phase: 'encoding', current: specs.length, total: specs.length });
    gif.finish();
    const bytes = gif.bytes();
    onProgress?.({ phase: 'done', current: specs.length, total: specs.length });
    return new Blob([bytes], { type: 'image/gif' });
  })();

  return { cancel, promise };
}

export { CancelledError };
