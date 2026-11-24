import { ANIMATIONS, type AnimationId } from '@/lib/companion/model';
import { RASTER_RIGS, SPRITE, type RasterPart } from './raster-rig';

// ─── Sketchy's artwork on the GPU ─────────────────────────────────────────────
// One textured mesh per pose over its approved 300 × 360 sprite, its joints
// (raster-rig.tsx) turned a little by the engine (raster-engine.ts).
//
// - Colours are premultiplied on upload and the canvas composites
//   premultiplied. A non-premultiplied canvas is drawn by Safari on iPhone with
//   pale fringes on every soft edge (ears, tail, feet), and its filtering mixes
//   transparent texels into the fur.
// - The canvas holds as many pixels as it shows on screen (device pixels), so
//   the browser never rescales it (rescaling made the edges jagged on phones),
//   and the artwork is mipmapped (in a 512 × 512 texture), so drawing him
//   smaller than the sprite stays smooth at any screen density.
// - Every pose is fetched and decoded once, up front (preloadSketchy).
// - A new pose replaces the old one at once; what only the old one covered
//   fades out over a moment, so a change of pose never snaps.

const images = new Map<AnimationId, HTMLImageElement>();

/** The shared picture of a pose (one request per pose for the whole page). */
export function sketchyImage(id: AnimationId): HTMLImageElement {
  let image = images.get(id);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = `/sketchy/${id}.webp`;
    images.set(id, image);
  }
  return image;
}

const ready = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0;

let preloading: Promise<void> | null = null;
/** Fetch and decode every pose (about 350 KB), so he never moves as a still picture. Resolves within `timeoutMs` whatever happens. */
export function preloadSketchy(timeoutMs = 3000): Promise<void> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return Promise.resolve();
  preloading ??= Promise.all(
    ANIMATIONS.map((id) => {
      const image = sketchyImage(id);
      if (ready(image)) return Promise.resolve();
      return typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : new Promise<void>((done) => {
            image.addEventListener('load', () => done(), { once: true });
            image.addEventListener('error', () => done(), { once: true });
          });
    }),
  ).then(() => undefined);
  return Promise.race([preloading, new Promise<void>((done) => window.setTimeout(done, timeoutMs))]);
}

/** The power-of-two texture each 300 × 360 sprite sits in (top left), for mipmaps. */
const TEX = 512;

const vertex = `attribute vec2 position; attribute vec2 uv; varying vec2 tex;
void main(){tex=uv;gl_Position=vec4(position.x/150.-1.,1.-position.y/180.,0.,1.);}`;

// highp where the GPU has it: phones run mediump at 16 bits, which quantises texture coordinates.
const fragment = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 tex; uniform sampler2D artwork; uniform vec4 eyes[2]; uniform vec2 gaze; uniform float blink; uniform float opacity;
void main(){
 vec2 pixel=tex*512.; vec2 source=tex;
 for(int i=0;i<2;i++){
  vec4 e=eyes[i];
  if(e.z>0.){
   vec2 q=(pixel-e.xy)/e.zw;
   float r=dot(q,q);
   // The iris moves with the gaze; the rim of the eye hardly at all.
   float inside=1.-smoothstep(.2,1.,r);
   source-=gaze*inside/512.;
   if(blink>0. && r<1. && q.y< -1.+2.1*blink){
    vec4 fur=texture2D(artwork,vec2(e.x+(pixel.x-e.x)*.3,e.y-e.w*1.9)/512.);
    float a=texture2D(artwork,tex).a;
    gl_FragColor=vec4(fur.rgb/max(fur.a,.004)*a,a)*opacity;return;
   }
  }
 }
 gl_FragColor=texture2D(artwork,source)*opacity;
}`;

// Flatten the small authored SVG polygon vocabulary, including relative rectangular paths.
function polygon(path: string): [number, number][] {
  const tokens = path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)!;
  const points: [number, number][] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      x = Number(tokens[i++]);
      y = Number(tokens[i++]);
    } else if (cmd === 'H') x = Number(tokens[i++]);
    else if (cmd === 'V') y = Number(tokens[i++]);
    else if (cmd === 'h') x += Number(tokens[i++]);
    else if (cmd === 'v') y += Number(tokens[i++]);
    else if (cmd.toLowerCase() === 'z') break;
    points.push([x, y]);
  }
  return points;
}

function influence(x: number, y: number, points: [number, number][]) {
  let inside = false;
  let distance = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(x - ax - k * dx, y - ay - k * dy));
  }
  const k = Math.max(0, Math.min(1, 0.5 + (inside ? distance : -distance) / 16));
  return k * k * (3 - 2 * k);
}

export const PARTS: RasterPart[] = ['tail', 'legBack', 'legFront', 'head', 'armFront'];
const STEP = 6;
const COLS = SPRITE.w / STEP + 1;
const ROWS = SPRITE.h / STEP + 1;
const POINTS: [number, number][] = [];
for (let y = 0; y <= SPRITE.h; y += STEP) for (let x = 0; x <= SPRITE.w; x += STEP) POINTS.push([x, y]);

const weightCache = new Map<AnimationId, Float32Array>();
/** How much each joint moves each mesh point of a pose (later, foreground parts own overlaps), computed once per pose. */
function weightsOf(id: AnimationId): Float32Array {
  let weights = weightCache.get(id);
  if (weights) return weights;
  const rig = RASTER_RIGS[id];
  const polygons = PARTS.map((part) => polygon(rig[part].path));
  weights = new Float32Array(POINTS.length * PARTS.length);
  for (let p = 0; p < POINTS.length; p++) {
    const [x, y] = POINTS[p];
    const w = polygons.map((poly) => influence(x, y, poly));
    for (let i = w.length - 1; i >= 0; i--) for (let j = 0; j < i; j++) w[j] *= 1 - w[i];
    weights.set(w, p * PARTS.length);
  }
  weightCache.set(id, weights);
  return weights;
}

export interface MeshMotion {
  /** Each joint's turn (degrees, clockwise, about its pivot). */
  angles: Record<RasterPart, number>;
  bodyY: number;
  bodyAngle: number;
  /** How far the irises move (sprite pixels). */
  gaze: { x: number; y: number };
  /** How far the head moves with its turn (sprite pixels). */
  head: { x: number; y: number };
  blink: number;
}

/** How long what only the previous pose covered takes to fade out (ms). */
export const FADE_MS = 170;

/** One GPU draw per pose per frame (two during a change of pose). */
export class RasterMesh {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private indices: WebGLBuffer;
  private indexCount = 0;
  private textures: [WebGLTexture, WebGLTexture];
  private holds: [AnimationId | null, AnimationId | null] = [null, null];
  private current = 0;
  private data = new Float32Array(POINTS.length * 4);
  private previous = new Float32Array(POINTS.length * 4);
  private shown: AnimationId | null = null;
  private fade: { from: AnimationId; start: number } | null = null;
  private last: { id: AnimationId; motion: MeshMotion; fade: boolean } | null = null;
  private pending: HTMLImageElement | null = null;
  private disposed = false;
  private announced = false;
  private resize: ResizeObserver | null = null;
  private where: Record<'position' | 'uv', number>;
  private uniforms: Record<'eyes' | 'gaze' | 'blink' | 'opacity', WebGLUniformLocation | null>;

  constructor(
    private canvas: HTMLCanvasElement,
    private onReady: () => void,
  ) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    this.program = gl.createProgram()!;
    const vs = shader(gl.VERTEX_SHADER, vertex);
    const fs = shader(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Raster shader link failed');
    gl.useProgram(this.program);
    this.where = { position: gl.getAttribLocation(this.program, 'position'), uv: gl.getAttribLocation(this.program, 'uv') };
    this.uniforms = {
      eyes: gl.getUniformLocation(this.program, 'eyes[0]'),
      gaze: gl.getUniformLocation(this.program, 'gaze'),
      blink: gl.getUniformLocation(this.program, 'blink'),
      opacity: gl.getUniformLocation(this.program, 'opacity'),
    };
    this.buffer = gl.createBuffer()!;
    const texture = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.textures = [texture(), texture()];
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    const indices: number[] = [];
    for (let y = 0; y < ROWS - 1; y++)
      for (let x = 0; x < COLS - 1; x++) {
        const a = y * COLS + x;
        indices.push(a, a + 1, a + COLS, a + 1, a + COLS + 1, a + COLS);
      }
    this.indices = gl.createBuffer()!;
    this.indexCount = indices.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener('webglcontextlost', this.lost);
    this.fit();
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(this.fit);
      this.resize.observe(canvas);
    }
  }

  /** As many canvas pixels as it shows (capped), redrawn at once after a change. */
  private fit = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.min(900, Math.round(this.canvas.clientWidth * ratio)));
    const h = Math.max(1, Math.min(1080, Math.round(this.canvas.clientHeight * ratio)));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.last && !this.disposed) this.draw(this.last.id, this.last.motion, this.last.fade);
  };

  private lost = () => {
    this.canvas.style.visibility = 'hidden';
    const fallback = this.canvas.parentElement?.querySelector<HTMLElement>('[data-raster-fallback]');
    if (fallback) fallback.style.visibility = 'visible';
  };

  /** Whether a pose change is still fading (the engine keeps drawing until it is done). */
  get fading() {
    return this.fade !== null;
  }

  private positions(id: AnimationId, motion: MeshMotion, out: Float32Array) {
    const rig = RASTER_RIGS[id];
    const weights = weightsOf(id);
    const turns = PARTS.map((part) => {
      const a = (motion.angles[part] * Math.PI) / 180;
      return [Math.cos(a), Math.sin(a), rig[part].pivot[0], rig[part].pivot[1]] as const;
    });
    const head = PARTS.indexOf('head');
    const angle = (motion.bodyAngle * Math.PI) / 180;
    const bc = Math.cos(angle);
    const bs = Math.sin(angle);
    for (let i = 0; i < POINTS.length; i++) {
      const [x, y] = POINTS[i];
      let nx = x;
      let ny = y;
      for (let j = 0; j < PARTS.length; j++) {
        const w = weights[i * PARTS.length + j];
        if (w < 0.001) continue;
        const [c, s, px, py] = turns[j];
        nx += w * (px + (x - px) * c - (y - py) * s - x);
        ny += w * (py + (x - px) * s + (y - py) * c - y);
        if (j === head) {
          nx += w * motion.head.x;
          ny += w * motion.head.y;
        }
      }
      const dx = nx - 175;
      const dy = ny - 280;
      const o = i * 4;
      out[o] = 175 + dx * bc - dy * bs;
      out[o + 1] = 280 + dx * bs + dy * bc + motion.bodyY;
      out[o + 2] = x / TEX;
      out[o + 3] = y / TEX;
    }
  }

  private pass(texture: WebGLTexture, data: Float32Array, id: AnimationId, gaze: { x: number; y: number }, blink: number, opacity: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.where.position);
    gl.vertexAttribPointer(this.where.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.where.uv);
    gl.vertexAttribPointer(this.where.uv, 2, gl.FLOAT, false, 16, 8);
    const eyes = RASTER_RIGS[id].eyes ?? [];
    gl.uniform4fv(this.uniforms.eyes, new Float32Array([...(eyes[0] ?? [0, 0, 0, 0]), ...(eyes[1] ?? [0, 0, 0, 0])]));
    gl.uniform2f(this.uniforms.gaze, gaze.x, gaze.y);
    gl.uniform1f(this.uniforms.blink, blink);
    gl.uniform1f(this.uniforms.opacity, opacity);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  /** Draw a pose in motion; `fade` lets a change of pose fade instead of snapping. */
  draw(id: AnimationId, motion: MeshMotion, fade = true) {
    if (this.disposed) return;
    this.last = { id, motion, fade };
    const image = sketchyImage(id);
    if (!ready(image)) {
      if (this.pending !== image) {
        this.pending?.removeEventListener('load', this.onLoad);
        this.pending = image;
        image.addEventListener('load', this.onLoad, { once: true });
      }
      return;
    }
    const gl = this.gl;
    const now = performance.now();
    if (this.shown !== id) {
      // The new pose goes to the other texture; the old one stays for its fade.
      const next = 1 - this.current;
      if (this.holds[next] !== id) {
        // Transparent all round, the sprite in its top left corner, then its smaller copies.
        gl.bindTexture(gl.TEXTURE_2D, this.textures[next]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX, TEX, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        this.holds[next] = id;
      }
      this.fade = fade && this.shown !== null ? { from: this.shown, start: now } : null;
      this.previous.set(this.data);
      this.current = next;
      this.shown = id;
    }
    this.positions(id, motion, this.data);
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.fade) {
      const f = (now - this.fade.start) / FADE_MS;
      if (f >= 1) this.fade = null;
      else this.pass(this.textures[1 - this.current], this.previous, this.fade.from, { x: 0, y: 0 }, 0, 1 - f);
    }
    this.pass(this.textures[this.current], this.data, id, motion.gaze, motion.blink, 1);
    if (!this.announced) {
      this.announced = true;
      this.onReady();
    }
  }

  private onLoad = () => {
    if (this.last && !this.disposed) this.draw(this.last.id, this.last.motion, this.last.fade);
  };

  dispose() {
    this.disposed = true;
    this.resize?.disconnect();
    this.pending?.removeEventListener('load', this.onLoad);
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteBuffer(this.indices);
    for (const t of this.textures) gl.deleteTexture(t);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
