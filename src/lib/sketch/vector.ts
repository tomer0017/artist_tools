/**
 * True vector output for Clean Outline.
 *
 * The line drawing is a soft ink field (0..1). Each chosen ink level is traced
 * with marching squares *with linear interpolation*, so the edge of every line
 * sits at the sub-pixel position where the ink crosses that level. The result
 * is closed polygons filled with the even-odd rule: real vector shapes that
 * scale cleanly, with no raster image inside. (They are thin filled shapes,
 * not single centre-line pen strokes.)
 *
 * Three levels keep the drawing's line weights: light soft-boundary lines,
 * medium lines and full contours, each a grey layer under the next.
 */

export interface VectorLayer {
  /** Ink level traced (0..1). */
  level: number;
  /** Fill colour of the layer. */
  fill: string;
}

/** Iso-contours of `field` at `level` as closed loops (x, y pairs in pixel units). */
export function isoLoops(field: Float32Array, w: number, h: number, level: number): Float32Array[] {
  const pw = w + 2;
  const ph = h + 2;
  // Padded sample grid; samples sit at pixel centres (x − 0.5, y − 0.5).
  const at = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? 0 : field[(y - 1) * w + (x - 1)]);
  const H = (x: number, y: number) => 2 * (y * pw + x); // edge (x,y)–(x+1,y)
  const V = (x: number, y: number) => 2 * (y * pw + x) + 1; // edge (x,y)–(x,y+1)
  const pos = new Map<number, [number, number]>();
  const links = new Map<number, number[]>();
  const vertex = (key: number, ax: number, ay: number, av: number, bx: number, by: number, bv: number) => {
    if (!pos.has(key)) {
      const t = av === bv ? 0.5 : (level - av) / (bv - av);
      pos.set(key, [ax + (bx - ax) * t - 0.5, ay + (by - ay) * t - 0.5]);
    }
    return key;
  };
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let y = 0; y < ph - 1; y++) {
    for (let x = 0; x < pw - 1; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const code = ((tl >= level ? 1 : 0) << 3) | ((tr >= level ? 1 : 0) << 2) | ((br >= level ? 1 : 0) << 1) | (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => vertex(H(x, y), x, y, tl, x + 1, y, tr);
      const bot = () => vertex(H(x, y + 1), x, y + 1, bl, x + 1, y + 1, br);
      const left = () => vertex(V(x, y), x, y, tl, x, y + 1, bl);
      const right = () => vertex(V(x + 1, y), x + 1, y, tr, x + 1, y + 1, br);
      switch (code) {
        case 1: case 14: link(left(), bot()); break;
        case 2: case 13: link(bot(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bot()); break;
        case 7: case 8: link(left(), top()); break;
        case 5:
        case 10: {
          // Saddle: decided by the cell centre, so thin diagonal lines stay joined.
          const centre = (tl + tr + br + bl) / 4 >= level;
          if ((code === 5) === centre) {
            link(left(), top());
            link(bot(), right());
          } else {
            link(top(), right());
            link(left(), bot());
          }
          break;
        }
      }
    }
  }
  const loops: Float32Array[] = [];
  const visited = new Set<number>();
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const pts: number[] = [];
    let current = start;
    let previous = -1;
    for (;;) {
      visited.add(current);
      const p = pos.get(current)!;
      pts.push(p[0], p[1]);
      const next = (links.get(current) ?? []).find((c) => c !== previous && !visited.has(c));
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    if (pts.length >= 6) loops.push(Float32Array.from(pts));
  }
  return loops;
}

/**
 * Ramer–Douglas–Peucker: drops vertices that sit within `epsilon` px of the
 * straight line between their neighbours, keeping every real turn.
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
      const d = segLen < 1e-6 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / segLen;
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
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return Float32Array.from(out);
}

const f2 = (v: number) => Number(v.toFixed(2)).toString();

function pathData(loops: Float32Array[]): string {
  const parts: string[] = [];
  for (const l of loops) {
    parts.push(`M${f2(l[0])} ${f2(l[1])}`);
    for (let i = 2; i < l.length; i += 2) parts.push(`L${f2(l[i])} ${f2(l[i + 1])}`);
    parts.push('Z');
  }
  return parts.join('');
}

export interface PathLayer {
  /** SVG path data in working pixels (even-odd fill). */
  d: string;
  fill: string;
  /** Closed loops in this layer. */
  loops: number;
}

/** The ink field as filled vector layers, lightest first. */
export function inkToPathLayers(ink: Float32Array, w: number, h: number, layers: VectorLayer[], epsilon = 0.3): PathLayer[] {
  return layers.map((layer) => {
    const loops = isoLoops(ink, w, h, layer.level)
      .map((l) => (epsilon > 0 ? simplify(l, epsilon) : l))
      .filter((l) => l.length >= 6);
    return { d: pathData(loops), fill: layer.fill, loops: loops.length };
  });
}

/**
 * A standalone SVG document of the layers. `width` × `height` is the size it
 * opens at (e.g. the original photo's); the drawing is scaled into it through
 * the viewBox, so it stays exact at any size.
 */
export function pathLayersToSvg(layers: PathLayer[], w: number, h: number, width = w, height = h): string {
  const body = layers
    .filter((l) => l.loops > 0)
    .map((l) => `<path d="${l.d}" fill="${l.fill}" fill-rule="evenodd"/>`)
    .join('\n');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#ffffff"/>`,
    body,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
}
