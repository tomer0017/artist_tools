import { inflateSync } from 'node:zlib';

// Reads back the PDFs the app makes (tests only, Node): page sizes, and what
// each page draws — stroked lines and rectangles with their width, colour and
// opacity, and placed images — in millimetres from the page's top-left
// corner; plus the embedded images' bytes. Enough for jsPDF's output (direct
// /Length, FlateDecode content streams), not a general PDF parser.

export const PT_PER_MM = 72 / 25.4;

export interface Stroke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Line width, mm. */
  width: number;
  /** #rrggbb */
  color: string;
  opacity: number;
}
export interface RectStroke {
  x: number;
  y: number;
  w: number;
  h: number;
  width: number;
  color: string;
  opacity: number;
}
export interface PlacedImage {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface InspectedPage {
  /** In points, as written. */
  mediaBox: number[];
  widthMm: number;
  heightMm: number;
  lines: Stroke[];
  rects: RectStroke[];
  images: PlacedImage[];
}
export interface InspectedImage {
  width: number;
  height: number;
  filter: string;
  bytes: Buffer;
}
export interface InspectedPdf {
  pages: InspectedPage[];
  printScalingNone: boolean;
  /** By object number. */
  images: Record<number, InspectedImage>;
  /** Image names on each page's resources → object number. */
  xobjects: Record<string, number>;
  text: string;
}

interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

function readObjects(buf: Buffer): Map<number, PdfObject> {
  const text = buf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(text))) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endobj', start);
    const streamAt = text.indexOf('stream', start);
    if (streamAt !== -1 && streamAt < end && !text.startsWith('endstream', streamAt - 3)) {
      const dict = text.slice(start, streamAt);
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? '0');
      const dataStart = streamAt + 'stream'.length + (text[streamAt + 6] === '\r' ? 2 : 1);
      objects.set(Number(match[1]), { dict, stream: buf.subarray(dataStart, dataStart + length) });
      header.lastIndex = dataStart + length;
    } else {
      objects.set(Number(match[1]), { dict: text.slice(start, end), stream: null });
      header.lastIndex = end;
    }
  }
  return objects;
}

const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/** Read a PDF the app made. */
export function inspectPdf(data: ArrayBuffer | Uint8Array): InspectedPdf {
  const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const objects = readObjects(buf);
  const text = buf.toString('latin1');

  // Opacity of each graphics state, and the images, by object number.
  const strokeAlpha = new Map<number, number>();
  const images: Record<number, InspectedImage> = {};
  for (const [id, obj] of objects) {
    const ca = /\/CA ([\d.]+)/.exec(obj.dict);
    // jsPDF writes graphics states as bare << /CA … >> dictionaries.
    if (ca) strokeAlpha.set(id, Number(ca[1]));
    if (/\/Subtype \/Image/.test(obj.dict) && obj.stream) {
      images[id] = {
        width: Number(/\/Width (\d+)/.exec(obj.dict)?.[1]),
        height: Number(/\/Height (\d+)/.exec(obj.dict)?.[1]),
        filter: /\/Filter \/(\w+)/.exec(obj.dict)?.[1] ?? '',
        bytes: Buffer.from(obj.stream),
      };
    }
  }
  const named = (dict: string, kind: string): Record<string, number> => {
    const block = new RegExp(`/${kind}\\s*<<([^>]*)>>`).exec(dict)?.[1] ?? '';
    return Object.fromEntries([...block.matchAll(/\/(\S+?)\s+(\d+) 0 R/g)].map((m) => [m[1], Number(m[2])]));
  };

  const pages: InspectedPage[] = [];
  const xobjects: Record<string, number> = {};
  for (const obj of objects.values()) {
    if (!/\/Type \/Page\b(?!s)/.test(obj.dict)) continue;
    const mediaBox = (/\/MediaBox \[([^\]]+)\]/.exec(obj.dict)?.[1] ?? '').trim().split(/\s+/).map(Number);
    const resourcesId = Number(/\/Resources (\d+) 0 R/.exec(obj.dict)?.[1]);
    const resources = objects.get(resourcesId)?.dict ?? obj.dict;
    const states = named(resources, 'ExtGState');
    Object.assign(xobjects, named(resources, 'XObject'));
    const contents = objects.get(Number(/\/Contents (\d+) 0 R/.exec(obj.dict)?.[1]));
    let stream = contents?.stream ?? Buffer.alloc(0);
    if (contents && /FlateDecode/.test(contents.dict)) stream = inflateSync(stream);
    const height = mediaBox[3] - mediaBox[1];
    const page: InspectedPage = { mediaBox, widthMm: (mediaBox[2] - mediaBox[0]) / PT_PER_MM, heightMm: height / PT_PER_MM, lines: [], rects: [], images: [] };
    const toMm = (x: number, y: number) => ({ x: x / PT_PER_MM, y: (height - y) / PT_PER_MM });

    type State = { width: number; color: string; opacity: number; matrix: number[] };
    let state: State = { width: 1, color: '#000000', opacity: 1, matrix: [1, 0, 0, 1, 0, 0] };
    const saved: State[] = [];
    let operands: number[] = [];
    let name = '';
    let current: { x: number; y: number } | null = null;
    let segments: [number, number, number, number][] = [];
    let rects: [number, number, number, number][] = [];
    for (const token of stream.toString('latin1').match(/\/[^\s/[\]()<>]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"*]+|\[|\]/g) ?? []) {
      if (token.startsWith('/')) {
        name = token.slice(1);
        continue;
      }
      if (/^[-+]?(?:\d|\.\d)/.test(token)) {
        operands.push(Number(token));
        continue;
      }
      const o = operands;
      switch (token) {
        case 'q':
          saved.push({ ...state, matrix: [...state.matrix] });
          break;
        case 'Q':
          state = saved.pop() ?? state;
          break;
        case 'w':
          state.width = o[0] / PT_PER_MM;
          break;
        case 'G':
          state.color = `#${hex(o[0])}${hex(o[0])}${hex(o[0])}`;
          break;
        case 'RG':
          state.color = `#${hex(o[0])}${hex(o[1])}${hex(o[2])}`;
          break;
        case 'gs':
          state.opacity = strokeAlpha.get(states[name]) ?? 1;
          break;
        case 'cm':
          state.matrix = o.slice(0, 6);
          break;
        case 'Do': {
          const [a, , , d, e, f] = state.matrix;
          const topLeft = toMm(e, f + d);
          page.images.push({ name, x: topLeft.x, y: topLeft.y, w: a / PT_PER_MM, h: d / PT_PER_MM });
          break;
        }
        case 'm':
          current = { x: o[0], y: o[1] };
          break;
        case 'l':
          if (current) segments.push([current.x, current.y, o[0], o[1]]);
          current = { x: o[0], y: o[1] };
          break;
        case 're':
          rects.push([o[0], o[1], o[2], o[3]]);
          break;
        case 'S':
          for (const [x1, y1, x2, y2] of segments) {
            const a = toMm(x1, y1);
            const b = toMm(x2, y2);
            page.lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: state.width, color: state.color, opacity: state.opacity });
          }
          for (const [x, y, w, h] of rects) {
            // jsPDF writes rectangles from their top-left corner with a negative height.
            const a = toMm(x, y);
            page.rects.push({ x: a.x, y: a.y + Math.min(0, -h / PT_PER_MM), w: w / PT_PER_MM, h: Math.abs(h) / PT_PER_MM, width: state.width, color: state.color, opacity: state.opacity });
          }
          segments = [];
          rects = [];
          break;
        case 'n':
          segments = [];
          rects = [];
          break;
      }
      operands = [];
    }
    pages.push(page);
  }
  return { pages, printScalingNone: /\/PrintScaling\s*\/None/.test(text), images, xobjects, text };
}
