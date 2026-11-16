/**
 * Image planes and the primitives the sketch styles are built from.
 *
 * A plane is a row-major Float32Array holding one value per pixel, 0..1
 * unless noted. Everything here is deterministic (no Math.random, no clocks)
 * and DOM-free, so the worker, the tests and Node scripts all compute exactly
 * the same numbers.
 *
 * Memory: every full-size buffer comes from a PlanePool and goes back to it as
 * soon as the stage that needed it is done. The engine's footprint is then a
 * small, fixed number of planes, measured by the pool and checked in tests,
 * not a heap of short-lived arrays waiting for the garbage collector. A phone
 * gives a web page far less memory than a desktop, and running out of it
 * reloads the page.
 */

/** Full-size Float32 buffers, reused between stages. */
export class PlanePool {
  private readonly free: Float32Array[] = [];
  private readonly wide: Float64Array[] = [];
  /** Bytes currently handed out. */
  live = 0;
  /** Most bytes handed out at once since the last reset. */
  peak = 0;
  /** Bytes allocated in total (handed out + kept for reuse). */
  allocated = 0;

  /**
   * @param maxFree how many returned planes to keep for reuse; the rest are
   *   dropped for the garbage collector (phones keep few).
   */
  constructor(
    readonly length: number,
    private readonly maxFree = Infinity,
  ) {}

  /** A plane of `length` values. Contents are undefined: callers overwrite it. */
  take(): Float32Array {
    let plane = this.free.pop();
    if (!plane) {
      plane = new Float32Array(this.length);
      this.allocated += plane.byteLength;
    }
    this.live += plane.byteLength;
    if (this.live > this.peak) this.peak = this.live;
    return plane;
  }

  /** A zero-filled plane. */
  takeZeroed(): Float32Array {
    const plane = this.take();
    plane.fill(0);
    return plane;
  }

  /** A plane holding a copy of `src`. */
  copy(src: Float32Array): Float32Array {
    const plane = this.take();
    plane.set(src);
    return plane;
  }

  /**
   * A double-precision plane, for a per-pixel value that is cached to skip a
   * costly function (Math.pow) while keeping the result bit-for-bit.
   */
  takeWide(): Float64Array {
    let plane = this.wide.pop();
    if (!plane) {
      plane = new Float64Array(this.length);
      this.allocated += plane.byteLength;
    }
    this.live += plane.byteLength;
    if (this.live > this.peak) this.peak = this.live;
    return plane;
  }

  giveWide(plane: Float64Array | null | undefined): void {
    if (!plane) return;
    this.live -= plane.byteLength;
    // There is only ever one wide plane; keep it for reuse only without a cap.
    if (this.maxFree === Infinity && this.wide.length < 1) this.wide.push(plane);
    else this.allocated -= plane.byteLength;
  }

  /** Return planes for reuse. Never use a plane after giving it back. */
  give(...planes: (Float32Array | null | undefined)[]): void {
    for (const plane of planes) {
      if (!plane) continue;
      this.live -= plane.byteLength;
      if (this.free.length < this.maxFree) this.free.push(plane);
      else this.allocated -= plane.byteLength;
    }
  }

  /** Forget the planes kept for reuse, so their memory can be reclaimed. */
  trim(): void {
    for (const plane of this.free) this.allocated -= plane.byteLength;
    for (const plane of this.wide) this.allocated -= plane.byteLength;
    this.free.length = 0;
    this.wide.length = 0;
  }

  resetPeak(): void {
    this.peak = this.live;
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const smoothstep = (e0: number, e1: number, v: number) => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** u = sqrt(width × height) / 1000: spatial settings are multiples of it, so a drawing looks the same at any working size. */
export const unit = (w: number, h: number) => Math.sqrt(w * h) / 1000;

/* ------------------------------------------------------------- colour -- */

const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** CIE L* / 100 of sRGB pixels (0 = black, 1 = white): perceptually even steps. */
export function lightness(rgba: Uint8ClampedArray, out: Float32Array): Float32Array {
  const n = out.length;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const y =
      0.2126 * SRGB_TO_LINEAR[rgba[i]] +
      0.7152 * SRGB_TO_LINEAR[rgba[i + 1]] +
      0.0722 * SRGB_TO_LINEAR[rgba[i + 2]];
    out[p] = y > 0.008856 ? 1.16 * Math.cbrt(y) - 0.16 : 9.033 * y;
  }
  return out;
}

/** Histogram percentile of a 0..1 plane (1024 bins). */
export function percentile(src: Float32Array, q: number): number {
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    hist[v <= 0 ? 0 : v >= 1 ? BINS - 1 : (v * (BINS - 1)) | 0]++;
  }
  const target = q * src.length;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= target) return b / (BINS - 1);
  }
  return 1;
}

/** Stretch the [lo, hi] percentiles onto 0..1, in place, so a flat photo is treated like a crisp one. */
export function stretch(src: Float32Array, loQ = 0.005, hiQ = 0.995): Float32Array {
  const lo = percentile(src, loQ);
  const hi = Math.max(lo + 0.05, percentile(src, hiQ));
  const k = 1 / (hi - lo);
  for (let i = 0; i < src.length; i++) src[i] = clamp01((src[i] - lo) * k);
  return src;
}

/**
 * Logarithmic shadow lift, in place: log(1 + k·L) / log(1 + k). Equal ratios
 * of light become closer to equal steps, so an ear in shadow against dark hair
 * registers like a lit edge of the same relative contrast. k = 0 is a no-op.
 */
export function liftShadows(L: Float32Array, k: number): Float32Array {
  if (k <= 0) return L;
  const norm = 1 / Math.log1p(k);
  for (let i = 0; i < L.length; i++) L[i] = Math.log1p(k * L[i]) * norm;
  return L;
}

/* --------------------------------------------------------------- blur -- */

export function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** 1-D convolution along rows (axis 0) or columns (axis 1), clamped borders. */
function convolve1d(src: Float32Array, dst: Float32Array, w: number, h: number, k: Float32Array, axis: 0 | 1) {
  const r = (k.length - 1) >> 1;
  if (axis === 0) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        if (x >= r && x < w - r) {
          const base = row + x - r;
          for (let i = 0; i < k.length; i++) acc += k[i] * src[base + i];
        } else {
          for (let i = -r; i <= r; i++) {
            const xx = x + i < 0 ? 0 : x + i > w - 1 ? w - 1 : x + i;
            acc += k[i + r] * src[row + xx];
          }
        }
        dst[row + x] = acc;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      if (y >= r && y < h - r) {
        for (let x = 0; x < w; x++) dst[row + x] = 0;
        for (let i = 0; i < k.length; i++) {
          const kv = k[i];
          const srow = (y - r + i) * w;
          for (let x = 0; x < w; x++) dst[row + x] += kv * src[srow + x];
        }
      } else {
        for (let x = 0; x < w; x++) {
          let acc = 0;
          for (let i = -r; i <= r; i++) {
            const yy = y + i < 0 ? 0 : y + i > h - 1 ? h - 1 : y + i;
            acc += k[i + r] * src[yy * w + x];
          }
          dst[row + x] = acc;
        }
      }
    }
  }
}

/**
 * Separable Gaussian (kernel to 3σ) into a new plane from the pool. Large σ
 * uses three box passes, whose cost does not grow with the scale.
 */
export function blur(src: Float32Array, w: number, h: number, sigma: number, pool: PlanePool): Float32Array {
  if (sigma < 0.25) return pool.copy(src);
  if (sigma > 8) return boxBlur3(src, w, h, sigma, pool);
  const k = gaussianKernel(sigma);
  const tmp = pool.take();
  const out = pool.take();
  convolve1d(src, tmp, w, h, k, 0);
  convolve1d(tmp, out, w, h, k, 1);
  pool.give(tmp);
  return out;
}

function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, axis: 0 | 1) {
  const norm = 1 / (2 * r + 1);
  const len = axis === 0 ? w : h;
  const count = axis === 0 ? h : w;
  const stride = axis === 0 ? w : 1;
  const step = axis === 0 ? 1 : w;
  for (let line = 0; line < count; line++) {
    const o = line * stride;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[o + (i < 0 ? 0 : i > len - 1 ? len - 1 : i) * step];
    for (let i = 0; i < len; i++) {
      dst[o + i * step] = sum * norm;
      const add = i + r + 1;
      const sub = i - r;
      sum += src[o + (add > len - 1 ? len - 1 : add) * step] - src[o + (sub < 0 ? 0 : sub) * step];
    }
  }
}

/** Three box passes in place (≈ Gaussian of `sigma`). */
export function boxBlur3InPlace(io: Float32Array, w: number, h: number, sigma: number, pool: PlanePool): Float32Array {
  const r = Math.max(1, Math.round(sigma * 0.86));
  const tmp = pool.take();
  for (let pass = 0; pass < 3; pass++) {
    boxPass(io, tmp, w, h, r, 0);
    boxPass(tmp, io, w, h, r, 1);
  }
  pool.give(tmp);
  return io;
}

export function boxBlur3(src: Float32Array, w: number, h: number, sigma: number, pool: PlanePool): Float32Array {
  return boxBlur3InPlace(pool.copy(src), w, h, sigma, pool);
}

/* -------------------------------------------------- edge-preserving -- */

/**
 * Domain-transform recursive filter (Gastal & Oliveira 2011), in place.
 * `sigmaS` is the spatial reach in pixels, `sigmaR` the size of a step (0..1)
 * that counts as an edge and is kept sharp.
 */
export function domainTransform(io: Float32Array, w: number, h: number, sigmaS: number, sigmaR: number, pool: PlanePool, iterations = 3): Float32Array {
  if (sigmaS <= 0.5) return io;
  const Q = 1023;
  // Both difference tables fit in one pooled plane (2 × 16 bits per pixel).
  const scratch = pool.take();
  const both = new Uint16Array(scratch.buffer, scratch.byteOffset, 2 * w * h);
  const dH = both.subarray(0, w * h);
  const dV = both.subarray(w * h);
  dH.fill(0);
  dV.fill(0);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w; x++) {
      const d = Math.abs(io[row + x] - io[row + x - 1]) * Q;
      dH[row + x] = d > Q ? Q : d;
    }
  }
  for (let y = 1; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const d = Math.abs(io[row + x] - io[row - w + x]) * Q;
      dV[row + x] = d > Q ? Q : d;
    }
  }
  const ratio = sigmaS / sigmaR / Q;
  const denom = Math.sqrt(Math.pow(4, iterations) - 1);
  const lut = new Float32Array(Q + 1);
  for (let it = 0; it < iterations; it++) {
    const sigmaH = (sigmaS * Math.sqrt(3) * Math.pow(2, iterations - (it + 1))) / denom;
    const k = -Math.SQRT2 / sigmaH;
    for (let d = 0; d <= Q; d++) lut[d] = Math.exp(k * (1 + ratio * d));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) io[row + x] += lut[dH[row + x]] * (io[row + x - 1] - io[row + x]);
      for (let x = w - 2; x >= 0; x--) io[row + x] += lut[dH[row + x + 1]] * (io[row + x + 1] - io[row + x]);
    }
    for (let y = 1; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) io[row + x] += lut[dV[row + x]] * (io[row - w + x] - io[row + x]);
    }
    for (let y = h - 2; y >= 0; y--) {
      const row = y * w;
      for (let x = 0; x < w; x++) io[row + x] += lut[dV[row + w + x]] * (io[row + w + x] - io[row + x]);
    }
  }
  pool.give(scratch);
  return io;
}

/* ----------------------------------------------------------- gradient -- */

/** Scharr gradient (better rotational symmetry than Sobel), ÷ 32, into `gx` and `gy`. */
export function gradients(src: Float32Array, w: number, h: number, gx: Float32Array, gy: Float32Array): void {
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const a = src[ym * w + xm], b = src[ym * w + x], c = src[ym * w + xp];
      const d = src[y * w + xm], f = src[y * w + xp];
      const g = src[yp * w + xm], hh = src[yp * w + x], i = src[yp * w + xp];
      gx[y * w + x] = (3 * (c + i) + 10 * f - 3 * (a + g) - 10 * d) / 32;
      gy[y * w + x] = (3 * (g + i) + 10 * hh - 3 * (a + c) - 10 * b) / 32;
    }
  }
}

/** Bilinear sample with clamped borders. */
export function sample(src: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0;
  else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0;
  else if (y > h - 1) y = h - 1;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 < w - 1 ? x0 + 1 : x0;
  const y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const r0 = y0 * w;
  const r1 = y1 * w;
  const top = src[r0 + x0] + (src[r0 + x1] - src[r0 + x0]) * fx;
  const bot = src[r1 + x0] + (src[r1 + x1] - src[r1 + x0]) * fx;
  return top + (bot - top) * fy;
}

/* ------------------------------------------------- deterministic noise -- */

/** Integer hash → 0..1: the same value for the same (x, y, seed) on every engine. */
export function hash01(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
