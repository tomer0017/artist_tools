/**
 * Line extraction for the sketch styles.
 *
 * The contour lines are a flow-based difference of Gaussians (Kang et al.
 * 2007, "Coherent Line Drawing", in the separable form of Kyprianidis &
 * Döllner 2008): the DoG is taken across the local edge direction and then
 * smoothed along it, so lines come out continuous and texture without a
 * consistent direction cancels out. Soft boundaries (a cast shadow's edge, a
 * jaw turning into shadow) are found separately, at a coarser scale.
 *
 * Every function takes its working buffers from a PlanePool and returns its
 * result as a pooled plane; the caller gives it back when done.
 */

import { blur, boxBlur3InPlace, gradients, sample, smoothstep, type PlanePool } from './planes';

/* ------------------------------------------------------- tangent field -- */

export interface TangentField {
  /** Unit tangent (along the edge). */
  tx: Float32Array;
  ty: Float32Array;
}

/** Smoothed structure tensor → its minor eigenvector, the edge tangent. */
export function tangentField(src: Float32Array, w: number, h: number, sigmaC: number, pool: PlanePool): TangentField {
  const n = w * h;
  const gx = pool.take();
  const gy = pool.take();
  gradients(src, w, h, gx, gy);
  const E = pool.take();
  const F = pool.take();
  const G = pool.take();
  for (let p = 0; p < n; p++) {
    E[p] = gx[p] * gx[p];
    F[p] = gx[p] * gy[p];
    G[p] = gy[p] * gy[p];
  }
  pool.give(gx, gy);
  // Three box passes approximate the Gaussian closely enough for a direction
  // field, at a cost that does not grow with the scale.
  boxBlur3InPlace(E, w, h, sigmaC, pool);
  boxBlur3InPlace(F, w, h, sigmaC, pool);
  boxBlur3InPlace(G, w, h, sigmaC, pool);
  // The tangent overwrites E and F (each pixel reads its own e, f, g first).
  const tx = E;
  const ty = F;
  for (let p = 0; p < n; p++) {
    const e = E[p];
    const f = F[p];
    const g = G[p];
    const disc = Math.sqrt((e - g) * (e - g) + 4 * f * f);
    const l1 = 0.5 * (e + g + disc);
    // Major eigenvector = gradient direction.
    let vx = l1 - g;
    let vy = f;
    let len = vx * vx + vy * vy;
    if (len < 1e-20) {
      vx = f;
      vy = l1 - e;
      len = vx * vx + vy * vy;
    }
    if (len < 1e-20) {
      tx[p] = 1;
      ty[p] = 0;
      continue;
    }
    len = Math.sqrt(len);
    tx[p] = -vy / len;
    ty[p] = vx / len;
  }
  pool.give(G);
  return { tx, ty };
}

/* ---------------------------------------------------------- flow DoG -- */

/**
 * Flow-based DoG. Pass 1 takes a 1-D DoG across the edge (along the
 * gradient); pass 2 averages that response along the tangent streamline (a
 * line integral convolution), which joins broken segments and cancels
 * undirected texture. Negative on the dark side of every edge.
 */
export function flowDoG(
  src: Float32Array,
  w: number,
  h: number,
  field: TangentField,
  sigmaE: number,
  sigmaM: number,
  pool: PlanePool,
  k = 1.6,
): Float32Array {
  const { tx, ty } = field;

  // --- pass 1: DoG across the edge ---
  const R = Math.max(1, Math.ceil(3 * k * sigmaE));
  const wDog = new Float32Array(R + 1);
  {
    let zE = 0;
    let zK = 0;
    const gE = new Float32Array(R + 1);
    const gK = new Float32Array(R + 1);
    for (let s = 0; s <= R; s++) {
      gE[s] = Math.exp(-(s * s) / (2 * sigmaE * sigmaE));
      gK[s] = Math.exp(-(s * s) / (2 * k * k * sigmaE * sigmaE));
      zE += s === 0 ? gE[s] : 2 * gE[s];
      zK += s === 0 ? gK[s] : 2 * gK[s];
    }
    for (let s = 0; s <= R; s++) wDog[s] = gE[s] / zE - gK[s] / zK;
  }
  const D = pool.take();
  for (let y = 0; y < h; y++) {
    const interiorRow = y > R && y < h - R - 1;
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      // Gradient direction = tangent rotated by −90°.
      const nx = ty[p];
      const ny = -tx[p];
      let acc = wDog[0] * src[p];
      if (interiorRow && x > R && x < w - R - 1) {
        // Fast path: the whole stencil is inside the frame, so the clamps in
        // `sample` are no-ops; the arithmetic is identical.
        for (let s = 1; s <= R; s++) {
          const dx = s * nx;
          const dy = s * ny;
          let ax = x + dx;
          let ay = y + dy;
          let x0 = ax | 0;
          let y0 = ay | 0;
          let fx = ax - x0;
          let fy = ay - y0;
          let r0 = y0 * w;
          let r1 = r0 + w;
          let top = src[r0 + x0] + (src[r0 + x0 + 1] - src[r0 + x0]) * fx;
          let bot = src[r1 + x0] + (src[r1 + x0 + 1] - src[r1 + x0]) * fx;
          const a = top + (bot - top) * fy;
          ax = x - dx;
          ay = y - dy;
          x0 = ax | 0;
          y0 = ay | 0;
          fx = ax - x0;
          fy = ay - y0;
          r0 = y0 * w;
          r1 = r0 + w;
          top = src[r0 + x0] + (src[r0 + x0 + 1] - src[r0 + x0]) * fx;
          bot = src[r1 + x0] + (src[r1 + x0 + 1] - src[r1 + x0]) * fx;
          acc += wDog[s] * (a + (top + (bot - top) * fy));
        }
      } else {
        for (let s = 1; s <= R; s++) {
          const dx = s * nx;
          const dy = s * ny;
          acc += wDog[s] * (sample(src, w, h, x + dx, y + dy) + sample(src, w, h, x - dx, y - dy));
        }
      }
      D[p] = acc;
    }
  }

  // --- pass 2: smooth along the flow ---
  const Rm = Math.max(1, Math.ceil(2.5 * sigmaM));
  const wm = new Float32Array(Rm + 1);
  for (let s = 0; s <= Rm; s++) wm[s] = Math.exp(-(s * s) / (2 * sigmaM * sigmaM));
  const H = pool.take();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let acc = wm[0] * D[p];
      let wsum = wm[0];
      for (let dir = -1; dir <= 1; dir += 2) {
        let cx = x;
        let cy = y;
        let vx = dir * tx[p];
        let vy = dir * ty[p];
        for (let s = 1; s <= Rm; s++) {
          cx += vx;
          cy += vy;
          if (cx < 0 || cy < 0 || cx > w - 1 || cy > h - 1) break;
          const q = ((cy + 0.5) | 0) * w + ((cx + 0.5) | 0);
          let nx = tx[q];
          let ny = ty[q];
          if (nx * vx + ny * vy < 0) {
            nx = -nx;
            ny = -ny;
          }
          vx = nx;
          vy = ny;
          // Inline bilinear (cx, cy are inside the frame here, so only the
          // far-edge neighbour needs a guard; same arithmetic as `sample`).
          const x0 = cx | 0;
          const y0 = cy | 0;
          const x1 = x0 < w - 1 ? x0 + 1 : x0;
          const r0 = y0 * w;
          const r1 = y0 < h - 1 ? r0 + w : r0;
          const fx = cx - x0;
          const top = D[r0 + x0] + (D[r0 + x1] - D[r0 + x0]) * fx;
          const bot = D[r1 + x0] + (D[r1 + x1] - D[r1 + x0]) * fx;
          acc += wm[s] * (top + (bot - top) * (cy - y0));
          wsum += wm[s];
        }
      }
      H[p] = acc / wsum;
    }
  }
  pool.give(D);
  return H;
}

/**
 * Soft threshold on the dark side of a DoG response: below `e0` nothing,
 * above `e1` full ink, smooth in between, which gives lines a tapered, drawn
 * weight instead of a hard binary edge.
 */
export function inkFromDoG(H: Float32Array, e0: number, e1: number, out: Float32Array): Float32Array {
  for (let p = 0; p < H.length; p++) out[p] = smoothstep(e0, e1, -H[p]);
  return out;
}

/* --------------------------------------------------------- soft edges -- */

/**
 * Ridges of a coarse-scale gradient, for soft boundaries too gradual for the
 * fine DoG. The gradient is normalised so its value is the lightness step
 * across the edge (0..1); the result holds that step on each ridge pixel
 * (non-maximum suppression) and 0 elsewhere. `hysteresis` then picks the
 * ridges by step size, so the thresholds can change without redoing this.
 */
export function softRidges(src: Float32Array, w: number, h: number, sigma: number, pool: PlanePool): Float32Array {
  const n = w * h;
  const B = blur(src, w, h, sigma, pool);
  const gx = pool.take();
  const gy = pool.take();
  gradients(B, w, h, gx, gy);
  pool.give(B);
  const k = Math.sqrt(2 * Math.PI) * sigma;
  const mag = pool.take();
  for (let p = 0; p < n; p++) mag[p] = Math.sqrt(gx[p] * gx[p] + gy[p] * gy[p]) * k;
  const nms = pool.takeZeroed();
  const T22 = Math.tan(Math.PI / 8);
  const T67 = Math.tan((3 * Math.PI) / 8);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const m = mag[p];
      if (m <= 0) continue;
      const ax = Math.abs(gx[p]);
      const ay = Math.abs(gy[p]);
      let a: number;
      let b: number;
      if (ay <= ax * T22) {
        a = mag[p - 1];
        b = mag[p + 1];
      } else if (ay >= ax * T67) {
        a = mag[p - w];
        b = mag[p + w];
      } else if (gx[p] * gy[p] > 0) {
        a = mag[p - w - 1];
        b = mag[p + w + 1];
      } else {
        a = mag[p - w + 1];
        b = mag[p + w - 1];
      }
      if (m >= a && m > b) nms[p] = m;
    }
  }
  pool.give(gx, gy, mag);
  return nms;
}

/** Hysteresis on ridge strengths: grow from ridges ≥ `high` through ridges ≥ `low`. Binary (0/1) result. */
export function hysteresis(ridges: Float32Array, w: number, h: number, low: number, high: number, pool: PlanePool): Float32Array {
  const n = w * h;
  const out = pool.takeZeroed();
  const stackPlane = pool.take();
  const stack = new Int32Array(stackPlane.buffer, stackPlane.byteOffset, n);
  for (let p = 0; p < n; p++) {
    if (ridges[p] < high || out[p]) continue;
    let top = 0;
    stack[top++] = p;
    out[p] = 1;
    while (top) {
      const q = stack[--top];
      const qx = q % w;
      const qy = (q / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = qy + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = qx + dx;
          if (xx < 0 || xx >= w) continue;
          const o = yy * w + xx;
          if (!out[o] && ridges[o] >= low) {
            out[o] = 1;
            stack[top++] = o;
          }
        }
      }
    }
  }
  pool.give(stackPlane);
  return out;
}

/* ---------------------------------------------------------- morphology -- */

/** Grey-level dilation with a square window (separable sliding maximum). */
export function dilate(src: Float32Array, w: number, h: number, r: number, pool: PlanePool): Float32Array {
  const R = Math.max(1, Math.round(r));
  const tmp = pool.take();
  const out = pool.take();
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const a = x - R < 0 ? 0 : x - R;
      const b = x + R > w - 1 ? w - 1 : x + R;
      for (let i = a; i <= b; i++) if (src[row + i] > m) m = src[row + i];
      tmp[row + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = y - R < 0 ? 0 : y - R;
    const b = y + R > h - 1 ? h - 1 : y + R;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let i = a; i <= b; i++) if (tmp[i * w + x] > m) m = tmp[i * w + x];
      out[y * w + x] = m;
    }
  }
  pool.give(tmp);
  return out;
}

/**
 * Hysteresis + size filter on a soft ink plane, in one labelling pass. A
 * stroke (8-connected run of ink > `weak`) survives only if it contains a
 * pixel ≥ `strong` and covers at least `minArea` pixels. Surviving pixels keep
 * their soft value, so line edges stay anti-aliased.
 */
export function cleanInk(
  ink: Float32Array,
  w: number,
  h: number,
  weak: number,
  strong: number,
  minArea: number,
  pool: PlanePool,
  /**
   * Optional: judge a stroke's strength by a DoG response instead of its ink.
   * A stroke is then kept only if −response reaches `min` somewhere on it.
   */
  byResponse?: { response: Float32Array; min: number },
): Float32Array {
  const n = w * h;
  const out = pool.takeZeroed();
  const seenPlane = pool.take();
  const seen = new Uint8Array(seenPlane.buffer, seenPlane.byteOffset, n);
  seen.fill(0);
  const stackPlane = pool.take();
  const stack = new Int32Array(stackPlane.buffer, stackPlane.byteOffset, n);
  const membersPlane = pool.take();
  const members = new Int32Array(membersPlane.buffer, membersPlane.byteOffset, n);
  for (let seed = 0; seed < n; seed++) {
    if (seen[seed] || ink[seed] <= weak) continue;
    let top = 0;
    let count = 0;
    let strongHit = false;
    stack[top++] = seed;
    seen[seed] = 1;
    while (top) {
      const q = stack[--top];
      members[count++] = q;
      if (byResponse ? -byResponse.response[q] >= byResponse.min : ink[q] >= strong) strongHit = true;
      const qx = q % w;
      const qy = (q / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = qy + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = qx + dx;
          if (xx < 0 || xx >= w) continue;
          const o = yy * w + xx;
          if (!seen[o] && ink[o] > weak) {
            seen[o] = 1;
            stack[top++] = o;
          }
        }
      }
    }
    if (strongHit && count >= minArea) for (let i = 0; i < count; i++) out[members[i]] = ink[members[i]];
  }
  pool.give(seenPlane, stackPlane, membersPlane);
  return out;
}

/** Thin binary edges → soft, anti-aliased strokes about `width` px wide. */
export function strokeEdges(edges: Float32Array, w: number, h: number, width: number, pool: PlanePool): Float32Array {
  const sigma = Math.max(0.5, width * 0.42);
  const soft = blur(edges, w, h, sigma, pool);
  // The peak of a blurred 1-px line is ≈ 1 / (sqrt(2π)·σ); rescale so a lone
  // line reaches full ink.
  const gain = Math.sqrt(2 * Math.PI) * sigma * 1.1;
  for (let p = 0; p < soft.length; p++) soft[p] = Math.min(1, soft[p] * gain);
  return soft;
}

/* --------------------------------------------------------- line weight -- */

/**
 * Bolder lines: a grey-level dilation with a round, soft-edged brush of
 * radius `r` px (fractional radii blend smoothly), so every line widens by the
 * same amount and keeps its anti-aliased edge and its darkness.
 */
export function thicken(ink: Float32Array, w: number, h: number, r: number, pool: PlanePool): Float32Array {
  const R = Math.max(1, Math.ceil(r + 0.5));
  const offsets: number[] = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const weight = Math.min(1, Math.max(0, r + 0.5 - Math.sqrt(dx * dx + dy * dy)));
      if (weight > 0) offsets.push(dx, dy, weight);
    }
  }
  // Most of a drawing is paper: only pixels with ink within the brush's reach
  // need the full disc.
  const near = dilate(ink, w, h, R, pool);
  const out = pool.takeZeroed();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (near[p] <= 0) continue;
      let m = 0;
      for (let i = 0; i < offsets.length; i += 3) {
        const xx = x + offsets[i];
        const yy = y + offsets[i + 1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = ink[yy * w + xx] * offsets[i + 2];
        if (v > m) m = v;
      }
      out[p] = m;
    }
  }
  pool.give(near);
  return out;
}

/**
 * Finer lines: each line keeps only the part of its cross-section where the
 * DoG response is above `amount` (0..1) of the line's own peak, so it narrows
 * towards its centre. The centre itself always survives with its darkness, so
 * faint lines get finer but do not disappear.
 */
export function narrow(ink: Float32Array, H: Float32Array, w: number, h: number, amount: number, reach: number, pool: PlanePool): Float32Array {
  const n = w * h;
  const response = pool.take();
  for (let p = 0; p < n; p++) response[p] = H[p] < 0 ? -H[p] : 0;
  const peak = dilate(response, w, h, reach, pool);
  const out = pool.takeZeroed();
  const lo = amount * 0.5;
  for (let p = 0; p < n; p++) {
    if (ink[p] <= 0) continue;
    const P = peak[p];
    out[p] = P > 0 ? ink[p] * smoothstep(lo * P, amount * P, response[p]) : 0;
  }
  pool.give(response, peak);
  return out;
}
