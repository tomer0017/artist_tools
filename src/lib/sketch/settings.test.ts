// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_VALUE_SETTINGS, type ValueSettings } from '@/types/project';
import { activeControls, resolveSketch } from './settings';

describe('saved sketch settings', () => {
  it('a project saved with the retired black-and-white trace opens as Clean Outline at the defaults, its old fields untouched', () => {
    const legacy = {
      grayscale: false,
      posterize: 0,
      contrast: 100,
      brightness: 100,
      mode: 'sketch',
      levels: 9,
      focus: 'none',
      sketchTrace: { ink: 70, detail: 20, separation: 80, invert: true, smoothing: 10, local: 30, simplify: 90, corners: 0 },
      sketchDetail: 3,
      sketchShading: true,
    } as ValueSettings;
    const before = JSON.stringify(legacy);
    const sketch = resolveSketch(legacy);
    expect(sketch).toEqual({ style: 'outline', outline: { lineWeight: 50, detail: 50 }, pencil: { lineWeight: 50, detail: 50, shading: 50 } });
    expect(activeControls(sketch)).toEqual({ lineWeight: 50, detail: 50, shading: 50 });
    // Reading never rewrites the project.
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it('keeps each style’s own settings, and repairs damaged values', () => {
    const sketch = resolveSketch({
      ...DEFAULT_VALUE_SETTINGS,
      sketchStyle: 'pencil',
      sketchOutline: { lineWeight: 80, detail: 20 },
      sketchPencil: { lineWeight: 10, detail: 300, shading: Number.NaN },
    });
    expect(sketch.style).toBe('pencil');
    expect(sketch.outline).toEqual({ lineWeight: 80, detail: 20 });
    expect(sketch.pencil).toEqual({ lineWeight: 10, detail: 100, shading: 50 });
    expect(activeControls(sketch)).toEqual({ lineWeight: 10, detail: 100, shading: 50 });
  });

  it('new projects start in Clean Outline, and unknown styles fall back to it', () => {
    expect(resolveSketch(DEFAULT_VALUE_SETTINGS).style).toBe('outline');
    expect(resolveSketch({ sketchStyle: 'stencil' as never }).style).toBe('outline');
    expect(resolveSketch(null).style).toBe('outline');
    expect('sketchTrace' in DEFAULT_VALUE_SETTINGS).toBe(false);
  });
});
