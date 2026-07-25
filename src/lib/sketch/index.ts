/**
 * Deterministic black & white vector trace.
 *
 *   const source = buildTraceSource(imageData);   // once per image
 *   const result = traceImage(source, settings);  // per control change
 *   renderTraceToCanvas(result, canvas);
 *   traceToSvg(result);                           // the same paths, scalable
 *
 * The filter makes no editorial decisions: how much black, how much
 * simplification and how much detail survives are set by the operator. See
 * `trace.ts` for what each control does.
 */

export {
  buildTraceSource,
  traceImage,
  DEFAULT_TRACE,
  TRACE_PRESETS,
  type TraceSettings,
  type TraceSource,
  type TraceResult,
} from './trace';
export { renderTraceToCanvas, type RenderOptions } from './render';
export { traceToSvg, loopPath, simplify, type PathSink } from './vector';
