/**
 * Sketch settings as a saved project stores them, read safely.
 *
 * Projects saved before November 2026 carry the retired black-and-white
 * trace's settings (`sketchTrace`, and earlier `sketchDetail` /
 * `sketchShading`). They still open: in Sketch, as Clean Outline at the
 * default controls, and the old fields stay in the project untouched.
 */

import {
  DEFAULT_SKETCH_OUTLINE,
  DEFAULT_SKETCH_PENCIL,
  type SketchOutlineSettings,
  type SketchPencilSettings,
  type SketchStyleId,
  type ValueSettings,
} from '@/types/project';
import { normalizeControls, type SketchControls } from './styles';

export interface ResolvedSketch {
  style: SketchStyleId;
  outline: SketchOutlineSettings;
  pencil: SketchPencilSettings;
}

export function resolveSketch(settings: Partial<ValueSettings> | null | undefined): ResolvedSketch {
  const style: SketchStyleId = settings?.sketchStyle === 'pencil' ? 'pencil' : 'outline';
  const outline = normalizeControls({ ...DEFAULT_SKETCH_OUTLINE, ...(settings?.sketchOutline ?? {}) });
  const pencil = normalizeControls({ ...DEFAULT_SKETCH_PENCIL, ...(settings?.sketchPencil ?? {}) });
  return {
    style,
    outline: { lineWeight: outline.lineWeight, detail: outline.detail },
    pencil: { lineWeight: pencil.lineWeight, detail: pencil.detail, shading: pencil.shading },
  };
}

/** The engine's controls for the active style. */
export function activeControls(sketch: ResolvedSketch): SketchControls {
  return sketch.style === 'pencil' ? { ...sketch.pencil } : { ...sketch.outline, shading: DEFAULT_SKETCH_PENCIL.shading };
}
