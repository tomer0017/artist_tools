/**
 * Sketch engine — public API.
 *
 * Two calls, deliberately split so the analysis is pure (and unit-testable)
 * and the canvas work is isolated:
 *
 *   const drawing = analyzeSketch(imageData, { detail: 0.5 });
 *   renderSketchToCanvas(drawing, canvas);
 *
 * See `styles.ts` for how to add a new sketch style (Outline / Pencil /
 * Construction / Ink already exist as data; the UI currently exposes only
 * "Artist sketch").
 */

export { analyzeSketch } from './pipeline';
export { renderSketchToCanvas, type RenderOptions } from './render';
export { SKETCH_STYLES, DEFAULT_SKETCH_STYLE, resolveParams, type SketchStyleDefinition } from './styles';
export type {
  LineWeight,
  SketchDrawing,
  SketchOptions,
  SketchParams,
  SketchShading,
  SketchSource,
  SketchStroke,
  SketchStyleId,
} from './types';
