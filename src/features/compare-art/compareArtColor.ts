// Compare Art — perceptual colour helpers (pure, testable).
//
// We compare in OKLab rather than raw RGB so that equal numeric RGB steps are
// not treated as equally meaningful across different colours. OKLab also gives
// us a painter-friendly split into Lightness, Chroma (saturation) and Hue, plus
// a simple warm/cool read from the a/b axes.

export interface OKLab {
  L: number; // ~0..1 perceptual lightness
  a: number; // green(−) … red(+)
  b: number; // blue(−) … yellow(+)
}

/** sRGB 0..255 channel → linear 0..1. */
function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Convert sRGB (0..255) to OKLab. */
export function rgbToOklab(r: number, g: number, b: number): OKLab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** Perceptual lightness only (0..1). Cheaper when hue is irrelevant. */
export function perceptualLightness(r: number, g: number, b: number): number {
  return rgbToOklab(r, g, b).L;
}

/** Chroma (saturation-like magnitude) in OKLab. */
export function oklabChroma(c: OKLab): number {
  return Math.hypot(c.a, c.b);
}

/** Hue angle (radians) in OKLab. */
export function oklabHue(c: OKLab): number {
  return Math.atan2(c.b, c.a);
}

/** Perceptual distance ΔE between two OKLab colours. */
export function oklabDistance(x: OKLab, y: OKLab): number {
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

export interface ColorDelta {
  deltaE: number; // total perceptual distance
  dL: number; // lightness: artwork − reference (positive = artwork lighter)
  dChroma: number; // artwork − reference (positive = artwork more saturated)
  dWarm: number; // warm/cool: positive = artwork warmer (toward red/yellow)
}

/**
 * Painter-oriented breakdown of the difference between an artwork pixel and the
 * reference pixel it aligns to. `art` and `ref` are OKLab.
 */
export function colorDelta(art: OKLab, ref: OKLab): ColorDelta {
  const dL = art.L - ref.L;
  const dChroma = oklabChroma(art) - oklabChroma(ref);
  // Warm/cool: OKLab +a is red, +b is yellow → both "warm"; −a green / −b blue
  // are "cool". Project the difference vector onto the warm axis (a+b)/√2.
  const dWarm = ((art.a - ref.a) + (art.b - ref.b)) / Math.SQRT2;
  return { deltaE: oklabDistance(art, ref), dL, dChroma, dWarm };
}

/** A short, painter-friendly label for a colour delta (or "close match"). */
export function describeDelta(d: ColorDelta, threshold: number): string {
  if (d.deltaE < threshold) return 'Close match';
  const parts: string[] = [];
  if (Math.abs(d.dL) > threshold * 0.6) parts.push(d.dL > 0 ? 'too light' : 'too dark');
  if (Math.abs(d.dWarm) > threshold * 0.6) parts.push(d.dWarm > 0 ? 'too warm' : 'too cool');
  if (Math.abs(d.dChroma) > threshold * 0.6) parts.push(d.dChroma > 0 ? 'too saturated' : 'too muted');
  return parts.length ? parts.join(', ') : 'slightly off';
}
