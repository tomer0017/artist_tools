/**
 * Sketch engine — public API.
 *
 * The analysis is split from the selection so that dragging the Detail slider
 * costs nothing and, more importantly, so that Detail can only ever *add* to
 * the drawing:
 *
 *   const analysis = buildSketchAnalysis(imageData);      // once per image
 *   const drawing  = composeSketch(analysis, { detail }); // per slider tick
 *   renderSketchToCanvas(drawing, canvas);
 *
 * `analyzeSketch()` does both in one call for callers that don't need the
 * cache. Everything except `renderSketchToCanvas` is pure and DOM-free.
 *
 * See `styles.ts` for how to add a new sketch style (Outline / Pencil /
 * Construction / Ink already exist as data; the UI currently exposes only
 * "Artist sketch").
 */

export { analyzeSketch, buildSketchAnalysis, composeSketch, resolveBudget } from './pipeline';
export { renderSketchToCanvas, type RenderOptions } from './render';
export {
  SKETCH_STYLES,
  DEFAULT_SKETCH_STYLE,
  styleParams,
  type SketchStyleDefinition,
} from './styles';
export { LAYER_ORDER, WEIGHT_ORDER } from './types';
export type {
  BudgetCurve,
  LayerMap,
  LineWeight,
  SketchAnalysis,
  SketchDrawing,
  SketchLayer,
  SketchOptions,
  SketchParams,
  SketchShading,
  SketchSource,
  SketchStroke,
  SketchStyleId,
} from './types';
