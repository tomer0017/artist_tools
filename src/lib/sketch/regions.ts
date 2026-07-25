/**
 * Sketch engine — binary regions.
 *
 * The trace thinks in *areas*, not edges: the question is not "where are the
 * contours?" but "which pixels are black?". Everything here operates on binary
 * masks — morphology to clean them up, connected components to size them, and
 * boundary tracing to turn them into polygons that a fill (or an SVG path) can
 * draw.
 */

/* ---------------------------------------------------------- grayscale max -- */

/**
 * Sliding-window maximum, separable, O(n) via a monotonic deque.
 *
 * Used by the local threshold to estimate the lit surface. A mean is no good
 * for that: a large dark area drags the average down with it, measures as no
 * darker than its own interior, and comes out hollow — the classic
 * adaptive-threshold failure. A maximum is not pulled down by the very region
 * it is meant to measure.
 */
export function maxFilter(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const deque = new Int32Array(Math.max(w, h) + 2 * r + 2);

  const pass = (
    input: Float32Array,
    output: Float32Array,
    length: number,
    count: number,
    stride: number,
    step: number,
  ) => {
    for (let line = 0; line < count; line++) {
      const origin = line * stride;
      const at = (i: number) => {
        const c = i < 0 ? 0 : i > length - 1 ? length - 1 : i;
        return input[origin + c * step];
      };
      let head = 0;
      let tail = 0;
      // Prime the window with [-r, r).
      for (let i = -r; i < r; i++) {
        const v = at(i);
        while (tail > head && at(deque[tail - 1]) <= v) tail--;
        deque[tail++] = i;
      }
      for (let i = 0; i < length; i++) {
        const incoming = i + r;
        const v = at(incoming);
        while (tail > head && at(deque[tail - 1]) <= v) tail--;
        deque[tail++] = incoming;
        while (deque[head] < i - r) head++;
        output[origin + i * step] = at(deque[head]);
      }
    }
  };

  pass(src, tmp, w, h, w, 1);
  pass(tmp, out, h, w, 1, w);
  return out;
}

/* ----------------------------------------------------------- morphology --- */

function binaryPass(
  input: Uint8Array,
  output: Uint8Array,
  length: number,
  count: number,
  stride: number,
  step: number,
  r: number,
  wantAll: boolean,
) {
  for (let line = 0; line < count; line++) {
    const origin = line * stride;
    // Running count of set pixels in the window; borders are treated as the
    // value that leaves the operation a no-op there (erosion sees "outside" as
    // set, dilation as clear), so a mass touching the frame is not eaten away.
    let sum = 0;
    const at = (i: number) => {
      if (i < 0 || i > length - 1) return wantAll ? 1 : 0;
      return input[origin + i * step];
    };
    for (let i = -r; i <= r; i++) sum += at(i);
    const window = 2 * r + 1;
    for (let i = 0; i < length; i++) {
      output[origin + i * step] = wantAll ? (sum === window ? 1 : 0) : sum > 0 ? 1 : 0;
      sum += at(i + r + 1) - at(i - r);
    }
  }
}

/** Square structuring element, applied separably. */
export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  binaryPass(mask, tmp, w, h, w, 1, r, false);
  binaryPass(tmp, out, h, w, 1, w, r, false);
  return out;
}

export function erodeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  binaryPass(mask, tmp, w, h, w, 1, r, true);
  binaryPass(tmp, out, h, w, 1, w, r, true);
  return out;
}

/** Opening removes speckle: pores, grain, weave, single-pixel noise. */
export function openMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return dilateMask(erodeMask(mask, w, h, r), w, h, r);
}

/** Closing welds a broken mass back together and fills pinholes. */
export function closeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return erodeMask(dilateMask(mask, w, h, r), w, h, r);
}

/* ------------------------------------------------------ connected regions -- */

export interface Component {
  label: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LabelledMask {
  labels: Int32Array;
  components: Component[];
}

/** 8-connected labelling with per-component area and bounds. */
export function labelComponents(mask: Uint8Array, w: number, h: number): LabelledMask {
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const components: Component[] = [];
  const stack = new Int32Array(n);

  for (let seed = 0; seed < n; seed++) {
    if (!mask[seed] || labels[seed] >= 0) continue;
    const label = components.length;
    const comp: Component = {
      label,
      area: 0,
      minX: w,
      minY: h,
      maxX: -1,
      maxY: -1,
    };
    let top = 0;
    stack[top++] = seed;
    labels[seed] = label;
    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p / w) | 0;
      comp.area++;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const o = ny * w + nx;
          if (mask[o] && labels[o] < 0) {
            labels[o] = label;
            stack[top++] = o;
          }
        }
      }
    }
    components.push(comp);
  }
  return { labels, components };
}

export interface HoleOptions {
  /**
   * Keep a pocket that looks like a *feature* — roughly as wide as it is tall
   * and solidly filled — even when it is below `minArea`.
   *
   * This is the difference between a portrait and a silhouette. An eye white,
   * the slot between a brow and a lid, the gap between a moustache and a lip
   * are all small, compact pockets; a threshold artifact is a thin sliver or a
   * ragged smear. Judging on shape as well as size lets the cleanup remove the
   * second without ever touching the first.
   */
  protectShaped?: boolean;
  /** Below this a pocket is filled regardless of shape — dust, not anatomy. */
  tinyArea?: number;
}

/**
 * Fill enclosed white pockets smaller than `minArea`.
 *
 * A trace wants solid masses, not masses full of pinholes from catchlights and
 * compression. Pockets that touch the frame are background and are left alone.
 */
export function fillSmallHoles(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea: number,
  options: HoleOptions = {},
): Uint8Array {
  const n = w * h;
  const out = Uint8Array.from(mask);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const members = new Int32Array(n);
  const tiny = options.tinyArea ?? 0;

  for (let seed = 0; seed < n; seed++) {
    if (mask[seed] || seen[seed]) continue;
    let top = 0;
    let count = 0;
    let touchesEdge = false;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    stack[top++] = seed;
    seen[seed] = 1;
    while (top > 0) {
      const p = stack[--top];
      members[count++] = p;
      const x = p % w;
      const y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // 4-connectivity for the background, the dual of 8 for the foreground —
      // mixing them would let a diagonal chain of black leak a hole open.
      if (x > 0 && !mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && !mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[top++] = p - w; }
      if (y < h - 1 && !mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[top++] = p + w; }
    }
    if (touchesEdge || count >= minArea) continue;
    if (options.protectShaped && count > tiny) {
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const elongation = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      if (elongation <= MAX_HOLE_ELONGATION && count / (bw * bh) >= MIN_HOLE_FILL) continue;
    }
    for (let i = 0; i < count; i++) out[members[i]] = 1;
  }
  return out;
}

/** A pocket this round and this solid is a feature, not a defect. */
const MAX_HOLE_ELONGATION = 4;
const MIN_HOLE_FILL = 0.4;

/* -------------------------------------------------------- boundary tracing -- */

/**
 * Marching squares: every black/white boundary as a closed loop of points.
 *
 * Orientation is not tracked, because the result is filled with the even-odd
 * rule — under which a hole is simply a loop inside another loop, and nesting
 * takes care of itself with no outer/inner bookkeeping at all.
 */
export function traceMaskBoundaries(mask: Uint8Array, w: number, h: number): Float32Array[] {
  // Sample grid padded by one clear pixel, so masses touching the frame still
  // close into a loop instead of running off the edge.
  const pw = w + 2;
  const ph = h + 2;
  const at = (x: number, y: number) => {
    if (x < 1 || y < 1 || x > w || y > h) return 0;
    return mask[(y - 1) * w + (x - 1)];
  };

  // Points live on half-integers; scaling by two keys them as exact integers.
  const key = (x2: number, y2: number) => y2 * (2 * pw + 2) + x2;
  const links = new Map<number, number[]>();
  const addSegment = (ax: number, ay: number, bx: number, by: number) => {
    const a = key(ax, ay);
    const b = key(bx, by);
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };

  for (let y = 0; y < ph - 1; y++) {
    for (let x = 0; x < pw - 1; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      // Edge midpoints, in doubled coordinates.
      const topX = 2 * x + 1, topY = 2 * y;
      const rightX = 2 * x + 2, rightY = 2 * y + 1;
      const botX = 2 * x + 1, botY = 2 * y + 2;
      const leftX = 2 * x, leftY = 2 * y + 1;
      switch (code) {
        case 1: case 14: addSegment(leftX, leftY, botX, botY); break;
        case 2: case 13: addSegment(botX, botY, rightX, rightY); break;
        case 3: case 12: addSegment(leftX, leftY, rightX, rightY); break;
        case 4: case 11: addSegment(topX, topY, rightX, rightY); break;
        case 6: case 9: addSegment(topX, topY, botX, botY); break;
        case 7: case 8: addSegment(leftX, leftY, topX, topY); break;
        // Saddles: resolved consistently so the two diagonal masses stay apart.
        case 5:
          addSegment(leftX, leftY, topX, topY);
          addSegment(botX, botY, rightX, rightY);
          break;
        case 10:
          addSegment(topX, topY, rightX, rightY);
          addSegment(leftX, leftY, botX, botY);
          break;
      }
    }
  }

  const loops: Float32Array[] = [];
  const visited = new Set<number>();
  const stride = 2 * pw + 2;
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const pts: number[] = [];
    let current = start;
    let previous = -1;
    for (;;) {
      visited.add(current);
      // Undo the padding and the doubling in one step.
      pts.push((current % stride) / 2 - 1, ((current / stride) | 0) / 2 - 1);
      const neighbours = links.get(current);
      if (!neighbours) break;
      let next = -1;
      for (const candidate of neighbours) {
        if (candidate !== previous && !visited.has(candidate)) {
          next = candidate;
          break;
        }
      }
      if (next < 0) break;
      previous = current;
      current = next;
    }
    if (pts.length >= 8) loops.push(Float32Array.from(pts));
  }
  return loops;
}
