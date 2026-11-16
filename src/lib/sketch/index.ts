/**
 * The sketch engine: Clean Outline and Pencil Study.
 *
 *   pipeline.ts   the engine for one picture, staged and cached (DOM-free)
 *   styles.ts     the two styles, their approved parameters and the controls
 *   vector.ts     Clean Outline as true vector shapes (SVG)
 *   sizing.ts     working and export sizes, and their memory limits
 *   client.ts     the page's side of the worker (coalesces slider changes)
 *   browser.ts    reading photo pixels, encoding PNGs, starting the worker
 *
 * Everything heavy runs in a Web Worker (sketch.worker.ts). The engine is
 * deterministic: the same photo and settings give the same pixels everywhere.
 */

export { SketchPipeline, OUTLINE_LAYERS, type PipelineStats } from './pipeline';
export {
  DEFAULT_CONTROLS,
  normalizeControls,
  lineWeight,
  detailMapping,
  pencilShading,
  type SketchControls,
  type SketchStyle,
} from './styles';
export { inkToPathLayers, pathLayersToSvg, isoLoops, simplify, type PathLayer, type VectorLayer } from './vector';
export {
  DESKTOP_LIMITS,
  MOBILE_LIMITS,
  MAX_CANVAS_PIXELS,
  fitSize,
  previewSize,
  pencilExportSize,
  outlineExportSize,
  type SketchLimits,
  type Size,
} from './sizing';
export { SketchClient, SketchError, type SketchImage, type WorkerLike, type PixelEncoder } from './client';
export type { SketchView, SketchRequest, SketchResponse, RenderTimings } from './protocol';
