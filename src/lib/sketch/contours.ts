/**
 * Sketch engine — turning a thinned edge map into polylines.
 *
 * This is the step that makes the difference between an edge *image* and a
 * *drawing*: once lines exist as chains of points we can measure them (length,
 * contrast, persistence), reject the ones a painter would not draw, and give
 * the survivors a weight and a taper.
 */

/** A traced chain of 8-connected edge pixels. `pts` holds x,y pairs. */
export interface RawContour {
  pts: Float32Array;
  closed: boolean;
}

const NX = [1, 1, 0, -1, -1, -1, 0, 1];
const NY = [0, 1, 1, 1, 0, -1, -1, -1];
// Inverse length of each neighbour step, for the collinearity preference below.
const NINV = NX.map((_, k) => 1 / Math.hypot(NX[k], NY[k]));

/**
 * Trace an edge map into chains.
 *
 * Chains break at junctions, so each branch of a fork is scored on its own
 * merits — a strong jaw meeting a weak stray hair should not drag the hair
 * along with it. Junction pixels are shared rather than consumed, which keeps
 * branches visually connected.
 */
export function traceContours(edge: Uint8Array, w: number, h: number): RawContour[] {
  const n = w * h;
  const degree = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!edge[p]) continue;
      let d = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + NX[k];
        const ny = y + NY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (edge[ny * w + nx]) d++;
      }
      degree[p] = d;
    }
  }

  const used = new Uint8Array(n);

  /**
   * Walk away from (sx, sy) preferring the straightest continuation, stopping
   * at a dead end or on arrival at a junction.
   */
  const walk = (sx: number, sy: number, includeSeed: boolean): number[] => {
    const out: number[] = [];
    let cx = sx;
    let cy = sy;
    if (includeSeed) {
      used[sy * w + sx] = 1;
      out.push(sx, sy);
    }
    let pdx = 0;
    let pdy = 0;
    for (;;) {
      let bestK = -1;
      let bestScore = -Infinity;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NX[k];
        const ny = cy + NY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const o = ny * w + nx;
        if (!edge[o] || used[o]) continue;
        // Straightest continuation first; nudge toward orthogonal steps so a
        // chain does not zig-zag diagonally across a horizontal ridge.
        const straight = pdx || pdy ? (NX[k] * pdx + NY[k] * pdy) * NINV[k] : 0;
        const score = straight + (k % 2 === 0 ? 0.1 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestK = k;
        }
      }
      if (bestK < 0) break;
      const nx = cx + NX[bestK];
      const ny = cy + NY[bestK];
      const o = ny * w + nx;
      out.push(nx, ny);
      pdx = NX[bestK];
      pdy = NY[bestK];
      if (degree[o] >= 3) break; // shared junction: reached, never consumed
      used[o] = 1;
      cx = nx;
      cy = ny;
    }
    return out;
  };

  const contours: RawContour[] = [];
  const emit = (seed: number) => {
    const sx = seed % w;
    const sy = (seed / w) | 0;
    const fwd = walk(sx, sy, true);
    const back = walk(sx, sy, false);
    let flat = fwd;
    if (back.length) {
      const rev: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2) rev.push(back[i], back[i + 1]);
      flat = rev.concat(fwd);
    }
    if (flat.length < 6) return; // fewer than 3 points is not a line
    const pts = Float32Array.from(flat);
    const closed =
      pts.length >= 16 &&
      Math.abs(pts[0] - pts[pts.length - 2]) <= 1 &&
      Math.abs(pts[1] - pts[pts.length - 1]) <= 1;
    contours.push({ pts, closed });
  };

  // Endpoints first, so open lines are traced end-to-end rather than from a
  // random midpoint; then whatever interior remains (closed loops).
  for (let p = 0; p < n; p++) if (edge[p] && degree[p] === 1 && !used[p]) emit(p);
  for (let p = 0; p < n; p++) if (edge[p] && degree[p] === 2 && !used[p]) emit(p);

  return contours;
}

/**
 * Bridge contour fragments back into whole lines.
 *
 * Non-maximum suppression and hysteresis routinely break a single jawline into
 * four arcs with two-pixel gaps, and every one of those arcs then scores as a
 * short unimportant fragment. Rejoining collinear endpoints is what turns the
 * raw material into contours a painter would recognise — and it is what lets
 * "length" mean anything in the prioritisation stage.
 *
 * `maxGap` is the largest jump to bridge and `minCos` is how straight the join
 * must be (both the outgoing tangent and the receiving tangent have to point
 * along the gap). `evidence` guards the whole thing: a bridge may only cross
 * ground where the image itself still shows some edge, so the engine can rejoin
 * a jawline broken by a highlight but can never weld a head outline to a twig
 * across empty background. Inventing a line is worse than leaving a gap.
 */
export function linkContours(
  contours: RawContour[],
  maxGap: number,
  minCos: number,
  evidence: Float32Array,
  evidenceFloor: number,
  w: number,
  h: number,
): RawContour[] {
  const open: (number[] | null)[] = [];
  const result: RawContour[] = [];
  for (const c of contours) {
    if (c.closed) result.push(c);
    else open.push(Array.from(c.pts));
  }
  if (!open.length) return result;

  const cell = Math.max(2, maxGap);
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  /** Mean edge evidence along the straight bridge, sampled per pixel. */
  const bridgeEvidence = (ax: number, ay: number, bx: number, by: number): number => {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    let sum = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const x = Math.round(ax + (bx - ax) * t);
      const y = Math.round(ay + (by - ay) * t);
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      sum += evidence[y * w + x];
    }
    return sum / steps;
  };

  const tangent = (pts: number[], atEnd: boolean): [number, number] => {
    const n = pts.length / 2;
    const span = Math.min(6, n - 1);
    const i = atEnd ? n - 1 : 0;
    const j = atEnd ? n - 1 - span : span;
    const dx = pts[i * 2] - pts[j * 2];
    const dy = pts[i * 2 + 1] - pts[j * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };

  for (let pass = 0; pass < 3; pass++) {
    // Endpoint index, rebuilt each pass because merging moves the ends.
    const grid = new Map<string, number[]>();
    const push = (x: number, y: number, id: number) => {
      const k = key(x, y);
      const bucket = grid.get(k);
      if (bucket) bucket.push(id);
      else grid.set(k, [id]);
    };
    for (let i = 0; i < open.length; i++) {
      const pts = open[i];
      if (!pts) continue;
      push(pts[0], pts[1], i);
      push(pts[pts.length - 2], pts[pts.length - 1], i);
    }

    let merged = false;
    // Longest first, so a strong contour claims its continuation before a
    // stray fragment can steal it.
    const order = open
      .map((pts, i) => (pts ? { i, len: pts.length } : null))
      .filter((v): v is { i: number; len: number } => v !== null)
      .sort((a, b) => b.len - a.len)
      .map((v) => v.i);

    for (const i of order) {
      for (const atEnd of [true, false]) {
        const pts = open[i];
        if (!pts) break;
        const n = pts.length / 2;
        const ex = atEnd ? pts[(n - 1) * 2] : pts[0];
        const ey = atEnd ? pts[(n - 1) * 2 + 1] : pts[1];
        const [tx, ty] = tangent(pts, atEnd);

        let best = -1;
        let bestAtEnd = false;
        let bestScore = minCos;
        const cx = Math.floor(ex / cell);
        const cy = Math.floor(ey / cell);
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            const bucket = grid.get(`${gx},${gy}`);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j === i) continue;
              const other = open[j];
              if (!other) continue;
              const m = other.length / 2;
              for (const otherEnd of [false, true]) {
                const ox = otherEnd ? other[(m - 1) * 2] : other[0];
                const oy = otherEnd ? other[(m - 1) * 2 + 1] : other[1];
                const dx = ox - ex;
                const dy = oy - ey;
                const gap = Math.hypot(dx, dy);
                if (gap > maxGap || gap < 1e-6) continue;
                const ux = dx / gap;
                const uy = dy / gap;
                const [ox2, oy2] = tangent(other, otherEnd);
                // A continues into the gap, and B's own end points back at A.
                const align = Math.min(tx * ux + ty * uy, -(ox2 * ux + oy2 * uy));
                if (align <= minCos) continue;
                if (bridgeEvidence(ex, ey, ox, oy) < evidenceFloor) continue;
                // Prefer straight *and* short joins.
                const score = align - gap / (maxGap * 6);
                if (score > bestScore) {
                  bestScore = score;
                  best = j;
                  bestAtEnd = otherEnd;
                }
              }
            }
          }
        }

        if (best < 0) continue;
        const a = atEnd ? pts : reverseXY(pts);
        const b = bestAtEnd ? reverseXY(open[best]!) : open[best]!;
        open[i] = a.concat(b);
        open[best] = null;
        merged = true;
      }
    }
    if (!merged) break;
  }

  for (const pts of open) {
    if (!pts || pts.length < 6) continue;
    const arr = Float32Array.from(pts);
    const closed =
      arr.length >= 16 &&
      Math.abs(arr[0] - arr[arr.length - 2]) <= 2 &&
      Math.abs(arr[1] - arr[arr.length - 1]) <= 2;
    result.push({ pts: arr, closed });
  }
  return result;
}

function reverseXY(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

/** Polyline arc length in pixels. */
export function polylineLength(pts: Float32Array): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - pts[i - 2];
    const dy = pts[i + 1] - pts[i - 1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/**
 * Ramer–Douglas–Peucker. Drops the pixel-grid staircase while keeping genuine
 * corners, which is what lets the renderer draw flowing curves instead of a
 * traced-looking jagged path.
 */
export function simplify(pts: Float32Array, epsilon: number): Float32Array {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const bx = pts[b * 2];
    const by = pts[b * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const segLen = Math.hypot(dx, dy);
    let far = -1;
    let farD = epsilon;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2];
      const py = pts[i * 2 + 1];
      const d =
        segLen < 1e-6
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / segLen;
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  return Float32Array.from(out);
}
