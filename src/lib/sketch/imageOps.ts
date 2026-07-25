/**
 * Sketch engine — image-processing primitives.
 *
 * All operators work on `Float32Array` luminance planes (0..255) so the
 * pipeline can chain them without repeatedly packing/unpacking RGBA.
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

/**
 * Gaussian blur approximated by three box passes — plenty accurate for the
 * regional maps (clutter / subject-ness) and far cheaper than a true kernel.
 */
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
 * This is the heart of stage 1. Unlike a Gaussian, it flattens texture
 * (fabric weave, pores, foliage speckle, sensor noise) while leaving real
 * object boundaries exactly where they were — which is the whole reason the
 * output can be simplified without the drawing drifting off the subject.
 *
 * `sigmaS` is spatial reach in pixels, `sigmaR` is how big a luminance step
 * counts as a real edge. O(n) per iteration, three iterations by convention.
 *
 * The per-pixel filter coefficient `exp(-sqrt(2)/sigmaH * (1 + sigmaS/sigmaR * d))`
 * depends only on the integer luminance step `d`, so it is table-driven — that
 * turns millions of `Math.exp` calls into array lookups and keeps a full-size
 * photo interactive on a phone.
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

/* -------------------------------------------------------------- gradients -- */

export interface Gradient {
  mag: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
}

/** Sobel with clamped borders, so a subject running off-frame still gets a line. */
export function sobel(src: Float32Array, w: number, h: number): Gradient {
  const mag = new Float32Array(w * h);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = (y > 0 ? y - 1 : 0) * w;
    const y1 = y * w;
    const y2 = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x2 = x < w - 1 ? x + 1 : w - 1;
      const tl = src[y0 + x0], tc = src[y0 + x], tr = src[y0 + x2];
      const ml = src[y1 + x0], mr = src[y1 + x2];
      const bl = src[y2 + x0], bc = src[y2 + x], br = src[y2 + x2];
      const dx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const dy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const o = y1 + x;
      gx[o] = dx;
      gy[o] = dy;
      mag[o] = Math.sqrt(dx * dx + dy * dy);
    }
  }
  return { mag, gx, gy };
}

/**
 * Multi-channel gradient via the Di Zenzo structure tensor.
 *
 * A painter draws the edge between a blue shirt and green foliage even when
 * the two are the same *value* — a luminance-only Sobel cannot see it at all.
 * Summing each channel's tensor and taking the dominant eigenpair gives one
 * magnitude and one orientation across all channels, so non-maximum
 * suppression downstream works unchanged.
 */
export function multiChannelGradient(
  planes: { data: Float32Array; weight: number }[],
  w: number,
  h: number,
): Gradient {
  const n = w * h;
  const jxx = new Float32Array(n);
  const jyy = new Float32Array(n);
  const jxy = new Float32Array(n);
  for (const plane of planes) {
    const g = sobel(plane.data, w, h);
    const k = plane.weight;
    for (let o = 0; o < n; o++) {
      const dx = g.gx[o] * k;
      const dy = g.gy[o] * k;
      jxx[o] += dx * dx;
      jyy[o] += dy * dy;
      jxy[o] += dx * dy;
    }
  }
  const mag = new Float32Array(n);
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    const a = jxx[o];
    const b = jyy[o];
    const c = jxy[o];
    const disc = Math.sqrt((a - b) * (a - b) + 4 * c * c);
    const lambda = (a + b + disc) / 2;
    if (lambda <= 0) continue;
    const m = Math.sqrt(lambda);
    // Eigenvector of [[a,c],[c,b]] for `lambda`.
    let vx = c;
    let vy = lambda - a;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) {
      vx = 1;
      vy = 0;
    } else {
      vx /= len;
      vy /= len;
    }
    mag[o] = m;
    gx[o] = vx * m;
    gy[o] = vy * m;
  }
  return { mag, gx, gy };
}

/**
 * Combine a value gradient and a colour gradient on equal terms.
 *
 * Each field is divided by its own reference level first, because the two are
 * not comparable raw: value edges stay razor-sharp through the edge-preserving
 * denoise while chroma is smooth to begin with, so a pure-colour boundary
 * measures an order of magnitude weaker than an equally obvious value one and
 * would never survive a shared threshold. After normalising, the stronger of
 * the two wins the pixel and supplies its orientation.
 */
export function normalizedMax(
  value: Gradient,
  colour: Gradient,
  valueRef: number,
  colourRef: number,
  colourWeight: number,
): Gradient {
  const n = value.mag.length;
  const mag = new Float32Array(n);
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const kv = 1 / Math.max(1e-6, valueRef);
  const kc = colourWeight / Math.max(1e-6, colourRef);
  for (let o = 0; o < n; o++) {
    const v = value.mag[o] * kv;
    const c = colour.mag[o] * kc;
    if (v >= c) {
      mag[o] = v;
      const s = value.mag[o] > 0 ? v / value.mag[o] : 0;
      gx[o] = value.gx[o] * s;
      gy[o] = value.gy[o] * s;
    } else {
      mag[o] = c;
      const s = colour.mag[o] > 0 ? c / colour.mag[o] : 0;
      gx[o] = colour.gx[o] * s;
      gy[o] = colour.gy[o] * s;
    }
  }
  return { mag, gx, gy };
}

/**
 * Non-maximum suppression — thins gradient ridges to single-pixel crests so
 * contours can be *traced* rather than blobbed. Direction is quantized to the
 * four 45° sectors, which is accurate enough after the stage-1 smoothing.
 */
export function nonMaxSuppress(g: Gradient, w: number, h: number): Float32Array {
  const { mag, gx, gy } = g;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = y * w + x;
      const m = mag[o];
      if (m <= 0) continue;
      const ax = Math.abs(gx[o]);
      const ay = Math.abs(gy[o]);
      let a: number, b: number;
      if (ax >= ay * 2.414) {
        a = mag[o - 1]; b = mag[o + 1];
      } else if (ay >= ax * 2.414) {
        a = mag[o - w]; b = mag[o + w];
      } else if (gx[o] * gy[o] >= 0) {
        a = mag[o - w - 1]; b = mag[o + w + 1];
      } else {
        a = mag[o - w + 1]; b = mag[o + w - 1];
      }
      if (m >= a && m >= b) out[o] = m;
    }
  }
  return out;
}

/**
 * Double-threshold + 8-connectivity. Weak pixels survive only when they are
 * part of a chain reaching a strong pixel — this is what keeps a faint but
 * continuous jawline while dropping equally faint isolated speckle.
 */
export function hysteresis(
  nms: Float32Array,
  w: number,
  h: number,
  high: number,
  low: number,
): Uint8Array {
  const edge = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let p = 0; p < nms.length; p++) {
    if (nms[p] >= high) {
      edge[p] = 1;
      stack.push(p);
    }
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
        const o = ny * w + nx;
        if (!edge[o] && nms[o] >= low) {
          edge[o] = 1;
          stack.push(o);
        }
      }
    }
  }
  return edge;
}

/* ----------------------------------------------------------- distributions -- */

/**
 * Histogram-based percentile. Exact sorting is unnecessary here and would cost
 * a full copy plus an O(n log n) sort on every slider tick.
 */
export function percentile(src: Float32Array, p: number, ignoreZero = false): number {
  let max = 0;
  for (let i = 0; i < src.length; i++) if (src[i] > max) max = src[i];
  if (max <= 0) return 0;
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  const scale = (BINS - 1) / max;
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v <= 0 && ignoreZero) continue;
    hist[(v * scale) | 0]++;
    n++;
  }
  if (!n) return 0;
  const target = p * n;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= target) return b / scale;
  }
  return max;
}

/** Percentile-stretch a map into 0..1 so downstream weights are image-relative. */
export function normalizeMap(src: Float32Array, loP = 0.02, hiP = 0.98): Float32Array {
  const lo = percentile(src, loP);
  const hi = percentile(src, hiP);
  const span = hi - lo;
  const out = new Float32Array(src.length);
  if (span <= 1e-6) return out;
  for (let i = 0; i < src.length; i++) out[i] = clamp01((src[i] - lo) / span);
  return out;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
