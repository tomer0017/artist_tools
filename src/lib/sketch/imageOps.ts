/**
 * Image-processing primitives for the vector trace.
 *
 * Operators work on `Float32Array` luminance planes (0..255) so the trace can
 * chain them without repeatedly packing and unpacking RGBA.
 */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function luminance(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

/* ------------------------------------------------------------------ blur -- */

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      sum += src[row + (i < 0 ? 0 : i > w - 1 ? w - 1 : i)];
    }
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      const addX = x + r + 1;
      const subX = x - r;
      sum += src[row + (addX > w - 1 ? w - 1 : addX)] - src[row + (subX < 0 ? 0 : subX)];
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      sum += src[(i < 0 ? 0 : i > h - 1 ? h - 1 : i) * w + x];
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm;
      const addY = y + r + 1;
      const subY = y - r;
      sum += src[(addY > h - 1 ? h - 1 : addY) * w + x] - src[(subY < 0 ? 0 : subY) * w + x];
    }
  }
}

/** Gaussian blur approximated by three box passes — accurate enough, far cheaper. */
export function gaussBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.round(sigma * 0.86));
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  return a;
}

/* -------------------------------------------------- edge-preserving smooth -- */

/**
 * Domain-transform recursive filter (Gastal & Oliveira 2011).
 *
 * The Smoothing control runs on this rather than on a Gaussian for one reason:
 * it flattens texture — fabric weave, pores, foliage speckle, sensor noise —
 * while leaving real boundaries exactly where they were. A Gaussian strong
 * enough to remove the texture also drags every edge in the picture with it,
 * and the threshold that follows would then land somewhere other than on the
 * shapes the operator can see.
 *
 * `sigmaS` is spatial reach in pixels, `sigmaR` is how big a luminance step
 * counts as a real edge. O(n) per iteration, three iterations by convention.
 *
 * The per-pixel coefficient `exp(-sqrt(2)/sigmaH * (1 + sigmaS/sigmaR * d))`
 * depends only on the integer luminance step `d`, so it is table-driven — which
 * turns millions of `Math.exp` calls into array lookups and keeps a full-size
 * photo responsive on a phone.
 */
export function domainTransform(
  src: Float32Array,
  w: number,
  h: number,
  sigmaS: number,
  sigmaR: number,
  iterations = 3,
): Float32Array {
  const out = Float32Array.from(src);
  if (sigmaS <= 0.5) return out;

  // Quantized luminance step along each axis (0..255).
  const dH = new Uint8Array(w * h);
  const dV = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w; x++) {
      const d = Math.abs(src[row + x] - src[row + x - 1]);
      dH[row + x] = d > 255 ? 255 : d;
    }
  }
  for (let y = 1; y < h; y++) {
    const row = y * w;
    const prev = row - w;
    for (let x = 0; x < w; x++) {
      const d = Math.abs(src[row + x] - src[prev + x]);
      dV[row + x] = d > 255 ? 255 : d;
    }
  }

  const ratio = sigmaS / sigmaR;
  const denom = Math.sqrt(Math.pow(4, iterations) - 1);
  const lut = new Float32Array(256);

  for (let it = 0; it < iterations; it++) {
    const sigmaH = (sigmaS * Math.sqrt(3) * Math.pow(2, iterations - (it + 1))) / denom;
    const k = -Math.SQRT2 / sigmaH;
    for (let d = 0; d < 256; d++) lut[d] = Math.exp(k * (1 + ratio * d));

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) {
        const v = lut[dH[row + x]];
        out[row + x] += v * (out[row + x - 1] - out[row + x]);
      }
      for (let x = w - 2; x >= 0; x--) {
        const v = lut[dH[row + x + 1]];
        out[row + x] += v * (out[row + x + 1] - out[row + x]);
      }
    }
    for (let y = 1; y < h; y++) {
      const row = y * w;
      const prev = row - w;
      for (let x = 0; x < w; x++) {
        const v = lut[dV[row + x]];
        out[row + x] += v * (out[prev + x] - out[row + x]);
      }
    }
    for (let y = h - 2; y >= 0; y--) {
      const row = y * w;
      const next = row + w;
      for (let x = 0; x < w; x++) {
        const v = lut[dV[next + x]];
        out[row + x] += v * (out[next + x] - out[row + x]);
      }
    }
  }
  return out;
}
