/**
 * Sketch engine — vector output.
 *
 * The trace styles are polygons all the way down, so the same path
 * construction serves the canvas renderer and the SVG exporter. That is what
 * makes the on-screen result and the exported file the same drawing rather
 * than two approximations of one.
 */

import type { SketchDrawing } from './types';

/**
 * Emit a closed loop as smooth path commands.
 *
 * Quadratic segments through the midpoints of the simplified polygon: the
 * staircase left by tracing a pixel mask disappears, corners stay where the
 * shape actually turns, and the result reads as a drawn shape rather than a
 * magnified bitmap.
 */
export function loopPath(
  points: Float32Array,
  scale: number,
  emit: {
    moveTo(x: number, y: number): void;
    quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
    closePath(): void;
  },
) {
  const n = points.length / 2;
  if (n < 3) return;
  const x = (i: number) => points[(i % n) * 2] * scale;
  const y = (i: number) => points[(i % n) * 2 + 1] * scale;
  emit.moveTo((x(0) + x(1)) / 2, (y(0) + y(1)) / 2);
  for (let i = 1; i <= n; i++) {
    emit.quadraticCurveTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
  }
  emit.closePath();
}

/** The same construction as `loopPath`, serialised as an SVG `d` attribute. */
function loopToPathData(points: Float32Array, scale: number, precision = 2): string {
  const parts: string[] = [];
  const f = (v: number) => Number(v.toFixed(precision)).toString();
  loopPath(points, scale, {
    moveTo: (px, py) => parts.push(`M${f(px)} ${f(py)}`),
    quadraticCurveTo: (cx, cy, px, py) => parts.push(`Q${f(cx)} ${f(cy)} ${f(px)} ${f(py)}`),
    closePath: () => parts.push('Z'),
  });
  return parts.join('');
}

/**
 * A complete, standalone SVG of the drawing.
 *
 * Filled masses go into one `evenodd` path — the rule turns every enclosed
 * loop into a hole automatically, so eyes and gaps come out right without any
 * outer/inner classification. Outlines follow as stroked paths.
 */
export function sketchToSvg(drawing: SketchDrawing, scale = 1): string {
  const w = Math.round(drawing.width * scale);
  const h = Math.round(drawing.height * scale);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${drawing.paper}"/>`,
  ];

  if (drawing.shapes && drawing.shapes.loops.length) {
    const d = drawing.shapes.loops.map((loop) => loopToPathData(loop, scale)).join('');
    if (d) parts.push(`<path d="${d}" fill="${drawing.ink}" fill-rule="evenodd"/>`);
  }

  for (const stroke of drawing.strokes) {
    const n = stroke.points.length / 2;
    if (n < 2) continue;
    const f = (v: number) => Number((v * scale).toFixed(2)).toString();
    const d: string[] = [`M${f(stroke.points[0])} ${f(stroke.points[1])}`];
    for (let i = 1; i < n - 1; i++) {
      const cx = stroke.points[i * 2];
      const cy = stroke.points[i * 2 + 1];
      d.push(
        `Q${f(cx)} ${f(cy)} ${f((cx + stroke.points[(i + 1) * 2]) / 2)} ${f(
          (cy + stroke.points[(i + 1) * 2 + 1]) / 2,
        )}`,
      );
    }
    d.push(`L${f(stroke.points[(n - 1) * 2])} ${f(stroke.points[(n - 1) * 2 + 1])}`);
    const width = (stroke.widths[0] * scale).toFixed(2);
    parts.push(
      `<path d="${d.join('')}" fill="none" stroke="${drawing.ink}" stroke-width="${width}"` +
        ` stroke-linecap="round" stroke-linejoin="round"` +
        ` opacity="${drawing.opacity[stroke.weightClass].toFixed(2)}"/>`,
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}
