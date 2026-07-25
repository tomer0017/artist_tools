/**
 * Sketch engine — vector output.
 *
 * The trace is polygons all the way down, so the same path construction serves
 * the canvas renderer and the SVG exporter. That is what makes the on-screen
 * result and the exported file the same drawing rather than two approximations
 * of one.
 */

import type { TraceResult } from './trace';

export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
}

/**
 * Emit a closed loop, with `roundness` (0..1) controlling how the path turns.
 *
 * At 0 the polygon is drawn as-is: every vertex is a hard corner, which is what
 * a hard-edged trace wants. At 1 each corner is replaced by a quadratic arc
 * through the segment midpoints, which removes the staircase a pixel mask
 * leaves behind. In between, the arc is cut back proportionally — so the
 * control is continuous rather than a two-state switch.
 */
export function loopPath(
  points: Float32Array,
  scale: number,
  emit: PathSink,
  roundness = 1,
) {
  const n = points.length / 2;
  if (n < 3) return;
  const r = Math.max(0, Math.min(1, roundness)) * 0.5;
  const x = (i: number) => points[(((i % n) + n) % n) * 2] * scale;
  const y = (i: number) => points[(((i % n) + n) % n) * 2 + 1] * scale;
  // Point `r` of the way from vertex i toward vertex j.
  const towards = (i: number, j: number): [number, number] => [
    x(i) + (x(j) - x(i)) * r,
    y(i) + (y(j) - y(i)) * r,
  ];

  if (r <= 0) {
    emit.moveTo(x(0), y(0));
    for (let i = 1; i < n; i++) emit.lineTo(x(i), y(i));
    emit.closePath();
    return;
  }

  const [sx, sy] = towards(0, 1);
  emit.moveTo(sx, sy);
  for (let i = 1; i <= n; i++) {
    const [ax, ay] = towards(i, i - 1);
    emit.lineTo(ax, ay);
    const [bx, by] = towards(i, i + 1);
    emit.quadraticCurveTo(x(i), y(i), bx, by);
  }
  emit.closePath();
}

/** The same construction as `loopPath`, serialised as an SVG `d` attribute. */
function loopToPathData(
  points: Float32Array,
  scale: number,
  roundness = 1,
  precision = 2,
): string {
  const parts: string[] = [];
  const f = (v: number) => Number(v.toFixed(precision)).toString();
  loopPath(
    points,
    scale,
    {
      moveTo: (px, py) => parts.push(`M${f(px)} ${f(py)}`),
      lineTo: (px, py) => parts.push(`L${f(px)} ${f(py)}`),
      quadraticCurveTo: (cx, cy, px, py) => parts.push(`Q${f(cx)} ${f(cy)} ${f(px)} ${f(py)}`),
      closePath: () => parts.push('Z'),
    },
    roundness,
  );
  return parts.join('');
}

/**
 * A standalone SVG of a trace — the same polygons the canvas draws, at any
 * scale, rather than a second approximation of the bitmap.
 */
export function traceToSvg(
  result: TraceResult,
  options: { scale?: number; paper?: string; ink?: string } = {},
): string {
  const scale = options.scale ?? 1;
  const paper = options.paper ?? '#ffffff';
  const ink = options.ink ?? '#000000';
  const w = Math.round(result.width * scale);
  const h = Math.round(result.height * scale);
  const roundness = result.settings.corners / 100;
  const d = result.loops.map((loop) => loopToPathData(loop, scale, roundness)).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${paper}"/>`,
    d ? `<path d="${d}" fill="${ink}" fill-rule="evenodd"/>` : '',
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Ramer–Douglas–Peucker. This is the Simplify control: it drops the pixel-grid
 * staircase a traced mask leaves behind while keeping the vertices where the
 * shape genuinely turns.
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
