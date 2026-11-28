import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildArtwork } from './artwork';
import { roomOf, isRound, type PieceOffset, type WallProject } from '../types';
import { sofaScaleOf } from '../render/interior';
import { frameGeometry } from '../render/frame';
import { activePiece, type PieceArt } from '../render/scene';
import { sofa3dOf, type SofaEntry } from '../sofas';

export interface StudioHooks {
  /** A tap on another artwork: edit that one. */
  onSelect?: (id: string) => void;
  /** An artwork dragged along the wall: where it now hangs (cm from its usual spot). */
  onMove?: (id: string, offset: PieceOffset) => void;
}

const VIDEO_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
/** The videos this browser says it can record from a canvas, best first: MP4 where it encodes it, then WebM. */
export function videoTypes(): string[] {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return [];
  const ok = VIDEO_TYPES.filter((type) => { try { return MediaRecorder.isTypeSupported(type); } catch { return false; } });
  // One of each container: a browser that claims MP4 but cannot encode it falls back to WebM.
  return [ok.find((t) => t.startsWith('video/mp4')), ok.find((t) => t.startsWith('video/webm'))].filter((t): t is string => !!t);
}
const ease = (p: number) => 0.5 - Math.cos(Math.PI * p) / 2;

function disposeObject(object: THREE.Object3D, textures = false) {
  const maps = new Set<THREE.Texture>();
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (textures) Object.values(m).forEach(v => { if (v instanceof THREE.Texture) maps.add(v); });
      m.dispose();
    }
  });
  maps.forEach(t => t.dispose());
}
function outlineRect(hw: number, hh: number) {
  const s = new THREE.Shape();
  s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, hh); s.lineTo(-hw, hh); s.closePath();
  return s;
}
function grainTexture(wood = false) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d')!; const image = ctx.createImageData(256, 256);
  let seed = 27;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const n = seed / 4294967296;
    const v = wood ? 210 + Math.sin(y * .8 + Math.sin(x * .025) * 2) * 18 + n * 20 : 125 + n * 35;
    const i = (y * 256 + x) * 4; image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(wood ? 2 : 8, wood ? 2 : 8);
  if (wood) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RoomStudio {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(48, 1, .025, 60);
  private controls: OrbitControls;
  private resize: ResizeObserver;
  private frames = new THREE.Group();
  private others: PieceArt[] = [];
  private artTextures = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  private sofaEntry: SofaEntry | null = null;
  private sofaHeight = .88;
  private wallHeight = 3.3;
  /** Each artwork's centre, usual height and outer size on the wall, metres. */
  private placed = new Map<string, { x: number; y: number; homeY: number; w: number; h: number }>();
  /** The selected artwork, and all of them together. */
  private focus = { x: 0, y: 1.6, radius: .5 };
  private union = { x: 0, y: 1.6, w: 1, h: 1 };
  /** A photo or a film is being made: the view is not to be touched. */
  private busy = false;
  private drag: { id: string; pointerId: number; start: THREE.Vector3; x: number; y: number; moved: boolean; offset: PieceOffset | null } | null = null;
  private raycaster = new THREE.Raycaster();
  private architecture = new THREE.Group();
  private sofa: THREE.Group | null = null;
  private project: WallProject;
  private art: HTMLCanvasElement;
  private wood = grainTexture(true);
  private plaster = grainTexture();
  private textures: THREE.Texture[] = [];
  private wallMaterial: THREE.MeshStandardMaterial;
  private floorMaterial: THREE.MeshStandardMaterial;
  private upholstery = { value: new THREE.Color('#b8b6b0') };
  private key = new THREE.DirectionalLight('#fff1dc', 3);
  private fill = new THREE.HemisphereLight('#f5f4ee', '#807262', 1.15);
  private picture = new THREE.SpotLight('#fff0dc', 0, 8, Math.PI / 3, .8, 2);
  private fixture = new THREE.Group();
  private env: THREE.WebGLRenderTarget;
  private raf = 0;
  private disposed = false;
  private visible = true;
  private observer: IntersectionObserver;
  private roomSize = 0;
  private centerY = 1.6;
  private radius = 1;
  
  constructor(private host: HTMLElement, project: WallProject, art: HTMLCanvasElement, private status: (state: 'ready' | 'error') => void, private hooks: StudioHooks = {}, others: PieceArt[] = []) {
    this.project = project; this.art = art; this.others = others;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D room');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#e9e4db');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.env = pmrem.fromScene(environment, .04); environment.dispose(); pmrem.dispose();
    this.scene.environment = this.env.texture; this.scene.environmentIntensity = .35;
    this.wallMaterial = new THREE.MeshStandardMaterial({ color: '#e4ded2', roughness: .93, bumpMap: this.plaster, bumpScale: .004 });
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: '#d8c0a1', roughness: .65 });
    this.scene.add(this.architecture, this.frames, this.fixture, this.fill, this.key, this.picture, this.picture.target);
    this.key.position.set(-3, 4.5, 3); this.key.target.position.set(0, .8, 0); this.scene.add(this.key.target);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .2, far: 15 });
    this.key.shadow.normalBias = .015; this.key.shadow.bias = -.0002; this.key.shadow.radius = 3;
    this.picture.castShadow = true; this.picture.shadow.mapSize.set(512, 512); this.picture.shadow.bias = -.0001;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .09;
    this.controls.minDistance = .25; this.controls.maxDistance = 8;
    this.controls.minAzimuthAngle = -Math.PI * .43; this.controls.maxAzimuthAngle = Math.PI * .43;
    this.controls.minPolarAngle = .35; this.controls.maxPolarAngle = Math.PI * .52;
    this.controls.panSpeed = .65; this.controls.rotateSpeed = .55; this.controls.zoomSpeed = .8;
    this.controls.addEventListener('change', this.invalidate);
    this.resize = new ResizeObserver(this.fit);
    this.resize.observe(host);
    // Before the orbit controls (capture phase): a press on an artwork drags it along the wall instead.
    host.addEventListener('pointerdown', this.pointerDown, { capture: true });
    host.addEventListener('pointermove', this.pointerMove);
    host.addEventListener('pointerup', this.pointerUp);
    host.addEventListener('pointercancel', this.pointerUp);
    this.observer = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; if (this.visible) this.invalidate(); });
    this.observer.observe(host);
    document.addEventListener('visibilitychange', this.visibility);
    this.update(project, art, others); this.reset();
    void this.load();
  }
  private makeArtTexture(art: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(art); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); return t;
  }
  private textureFor(art: HTMLCanvasElement) {
    let t = this.artTextures.get(art);
    if (!t) { t = this.makeArtTexture(art); this.artTextures.set(art, t); }
    return t;
  }
  private fit = () => {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (this.busy || w < 1 || h < 1) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.invalidate();
  };
  private contextLost = (event: Event) => { event.preventDefault(); this.status('error'); };
  private visibility = () => { if (!document.hidden) this.invalidate(); };
  private invalidate = () => {
    if (this.disposed || this.busy || this.raf || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.disposed) return;
      // Keep the camera inside the room, in front of the artwork wall and above the floor.
      this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -this.roomSize / 2 + .5, this.roomSize / 2 - .5);
      this.controls.target.y = THREE.MathUtils.clamp(this.controls.target.y, .3, Math.max(3, this.centerY + this.radius));
      this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, .04, 2);
      this.camera.position.z = Math.max(.12, this.camera.position.z); this.camera.position.y = Math.max(.18, this.camera.position.y);
      this.controls.update(); this.renderer.render(this.scene, this.camera);
    });
  };
  private box(parent: THREE.Group, size: [number, number, number], at: [number, number, number], mat: THREE.Material, radius = 0) {
    const mesh = new THREE.Mesh(radius ? new RoundedBoxGeometry(...size, 2, radius) : new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...at); mesh.receiveShadow = true; mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  private buildRoom(width: number, height: number) {
    this.scene.remove(this.architecture); disposeObject(this.architecture); this.architecture = new THREE.Group(); this.scene.add(this.architecture);
    // Material instances shared by the architecture are refreshed after disposal.
    this.wallMaterial = this.wallMaterial.clone(); this.floorMaterial = this.floorMaterial.clone();
    this.box(this.architecture, [width, height, .16], [0, height / 2, -.08], this.wallMaterial);
    this.box(this.architecture, [width, .12, 8], [0, -.06, 4], this.floorMaterial);
    this.box(this.architecture, [.14, height, 8], [width / 2, height / 2, 4], this.wallMaterial);
    // Left wall has a real opening, with recessed timber window mullions.
    const wall = this.wallMaterial;
    this.box(this.architecture, [.14, .65, 8], [-width / 2, .325, 4], wall);
    this.box(this.architecture, [.14, .55, 8], [-width / 2, height - .275, 4], wall);
    this.box(this.architecture, [.14, height, 1.4], [-width / 2, height / 2, .7], wall);
    this.box(this.architecture, [.14, height, 3.7], [-width / 2, height / 2, 6.15], wall);
    const trim = new THREE.MeshStandardMaterial({ color: '#dad3c5', roughness: .6 });
    this.box(this.architecture, [width, .12, .045], [0, .06, .025], trim);
    this.box(this.architecture, [.045, .12, 8], [width / 2 - .08, .06, 4], trim);
    const wood = new THREE.MeshStandardMaterial({ color: '#786148', roughness: .48, map: this.wood });
    for (const z of [1.4, 2.85, 4.3]) this.box(this.architecture, [.2, height - 1.2, .055], [-width / 2, height / 2 + .05, z], wood);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(3.1, height - 1.2), new THREE.MeshBasicMaterial({ color: '#e8f2f4' }));
    sky.rotation.y = Math.PI / 2; sky.position.set(-width / 2 - .15, height / 2 + .05, 2.85); this.architecture.add(sky);
    // Woven rug, travertine side table, ceramic vessel: all volumetric geometry.
    const rug = new THREE.MeshStandardMaterial({ color: '#b8aa91', roughness: 1, bumpMap: this.plaster, bumpScale: .008 });
    this.box(this.architecture, [3.2, .018, 2.35], [0, .014, 1.65], rug, .008);
    const stone = new THREE.MeshStandardMaterial({ color: '#c7b49a', roughness: .75, bumpMap: this.plaster, bumpScale: .009 });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(.28, .31, .5, 48), stone); table.position.set(-1.75, .25, .85); table.castShadow = table.receiveShadow = true; this.architecture.add(table);
    const points = [[.1,0],[.16,.07],[.15,.2],[.08,.28],[.065,.32]].map(([x,y]) => new THREE.Vector2(x,y));
    const vase = new THREE.Mesh(new THREE.LatheGeometry(points, 40), new THREE.MeshStandardMaterial({ color: '#a8957d', roughness: .72, side: THREE.DoubleSide }));
    vase.position.set(-1.75, .5, .85); vase.castShadow = true; this.architecture.add(vase);
  }
  private async load() {
    try {
      const loader = new THREE.TextureLoader();
      const [, color, normal, rough] = await Promise.all([
        this.loadSofa(sofa3dOf(this.project)),
        loader.loadAsync('/models/art-wall/floor-color.jpg'), loader.loadAsync('/models/art-wall/floor-normal.jpg'), loader.loadAsync('/models/art-wall/floor-rough.jpg'),
      ]);
      if (this.disposed) { [color, normal, rough].forEach(t => t.dispose()); return; }
      this.textures.push(color, normal, rough);
      color.colorSpace = THREE.SRGBColorSpace;
      [color, normal, rough].forEach(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 5); t.anisotropy = 4; });
      this.floorMaterial.map = color; this.floorMaterial.normalMap = normal; this.floorMaterial.roughnessMap = rough; this.floorMaterial.normalScale.set(.35,.35); this.floorMaterial.needsUpdate = true;
      this.update(this.project, this.art, this.others); this.status('ready');
    } catch { if (!this.disposed) this.status('error'); }
  }
  /** The sofa model the project names (sofas.ts), in place of the one shown. */
  private async loadSofa(entry: SofaEntry) {
    const model = entry.model!;
    this.sofaEntry = entry;
    const gltf = await new GLTFLoader().loadAsync(model.url);
    if (this.disposed || this.sofaEntry !== entry) { disposeObject(gltf.scene, true); return; }
    if (this.sofa) { this.scene.remove(this.sofa); disposeObject(this.sofa, true); }
    this.sofa = gltf.scene;
    this.sofa.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = o.receiveShadow = true;
        if (model.recolor !== 'upholstery') return;
        const material = (o.material as THREE.MeshStandardMaterial).clone();
        // Recolour neutral leather only; preserve the model's warm timber and all normal/roughness maps.
        material.onBeforeCompile = shader => {
          shader.uniforms.upholstery = this.upholstery;
          shader.fragmentShader = 'uniform vec3 upholstery;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            float leather = 1.0 - smoothstep(1.35, 1.8, diffuseColor.r / max(0.002, diffuseColor.g));
            float detail = .68 + .32 * sqrt(clamp(dot(diffuseColor.rgb, vec3(.2126,.7152,.0722)) / .025, 0.0, 1.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, upholstery * detail, leather);`);
        };
        o.material = material;
      });
    this.scene.add(this.sofa); this.update(this.project, this.art, this.others);
  }
  update(project: WallProject, art: HTMLCanvasElement, others: PieceArt[] = this.others) {
    this.project = project; this.art = art; this.others = others;
    const entry = sofa3dOf(project), model = entry.model!;
    if (this.sofaEntry && this.sofaEntry.id !== entry.id) void this.loadSofa(entry).catch(() => undefined);
    const shown = this.sofaEntry?.model ?? model;
    const sofaScale = entry.size.w / 100 * sofaScaleOf(project) / shown.widthM;
    this.sofaHeight = shown.heightM * sofaScale;
    // Every artwork at one scale: in a room each hangs its height above the sofa, on a wall they share a centre line; then its own offset.
    const base = this.sofaHeight + project.space.aboveSofaCm / 100;
    const geo = [{ piece: activePiece(project), canvas: art }, ...others.map((o) => ({ piece: o.piece, canvas: o.art }))].map(({ piece, canvas }) => {
      const a = piece.artwork;
      const g = frameGeometry(a.widthCm, isRound(a) ? a.widthCm : a.heightCm, piece.frame);
      return { piece, canvas, w: g.outerW / 100, h: g.outerH / 100 };
    });
    const tallest = Math.max(...geo.map((g) => g.h));
    const laid = geo.map((g) => {
      const homeY = base + (project.space.mode === 'room' ? g.h : tallest) / 2;
      return { ...g, homeY, x: g.piece.offset.x / 100, y: homeY + g.piece.offset.y / 100 };
    });
    const left = Math.min(...laid.map((p) => p.x - p.w / 2)), right = Math.max(...laid.map((p) => p.x + p.w / 2));
    const bottom = Math.min(...laid.map((p) => p.y - p.h / 2)), top = Math.max(...laid.map((p) => p.y + p.h / 2));
    const width = Math.max(6.8, 2 * Math.max(-left, right) + 2);
    this.centerY = (bottom + top) / 2;
    this.radius = Math.max(right - left, top - bottom) / 2;
    this.union = { x: (left + right) / 2, y: this.centerY, w: right - left, h: top - bottom };
    // The wall's height comes from the sizes, not from where pieces were dragged (dragging never grows the room).
    this.wallHeight = Math.max(3.3, base + tallest + .55);
    const height = Math.max(this.wallHeight, top + .3);
    if (this.roomSize !== width || this.architecture.userData.height !== height) { this.roomSize = width; this.buildRoom(width, height); this.architecture.userData.height = height; }
    const preset = roomOf(project.space.room.id);
    this.wallMaterial.color.set(project.space.mode === 'wall' ? project.space.wall.color : preset.wall.color);
    this.floorMaterial.color.set(project.space.room.id === 'loft' ? '#b7b4af' : '#ffffff');
    this.upholstery.value.set(project.space.room.sofaColor);
    if (this.sofa) { this.sofa.scale.setScalar(sofaScale); this.sofa.position.set(0, 0, shown.depthM / 2 * sofaScale + .07); }
    this.scene.remove(this.frames); disposeObject(this.frames); this.frames = new THREE.Group();
    this.placed.clear();
    const selected = project.pieceId ?? 'p1';
    for (const p of laid) {
      const group = buildArtwork({ ...project, artwork: p.piece.artwork, frame: p.piece.frame }, this.textureFor(p.canvas), this.wood);
      group.position.x = p.x; group.position.y = p.y; group.userData.id = p.piece.id;
      if (laid.length > 1 && p.piece.id === selected) group.add(this.outline(p.w, p.h, isRound(p.piece.artwork)));
      this.frames.add(group);
      this.placed.set(p.piece.id, { x: p.x, y: p.y, homeY: p.homeY, w: p.w, h: p.h });
      if (p.piece.id === selected) this.focus = { x: p.x, y: p.y, radius: Math.max(p.w, p.h) / 2 };
    }
    this.scene.add(this.frames);
    const used = new Set(laid.map((p) => p.canvas));
    for (const [canvas, texture] of this.artTextures) if (!used.has(canvas)) { texture.dispose(); this.artTextures.delete(canvas); }
    this.scene.remove(this.fixture); disposeObject(this.fixture); this.fixture = new THREE.Group(); this.scene.add(this.fixture);
    const lightY = top + .11;
    const temp = { warm: '#ffdcad', neutral: '#fff4df', cool: '#deebff' }[project.light.temperature];
    this.key.color.set(project.light.enabled ? temp : '#fff1dc');
    this.key.intensity = project.light.enabled ? 1.4 + project.light.intensity / 50 : 3;
    this.fill.intensity = project.light.enabled ? .55 : 1.15;
    this.picture.color.set(temp); this.picture.intensity = project.light.pictureLight ? 3 + project.light.intensity / 8 : 0;
    this.picture.position.set(this.union.x, lightY, .28); this.picture.target.position.set(this.union.x, this.centerY, 0);
    if (project.light.pictureLight) {
      const brass = new THREE.MeshStandardMaterial({ color: '#b69a5d', metalness: .85, roughness: .25 });
      for (const p of laid) {
        const y = p.y + p.h / 2 + .11;
        this.box(this.fixture, [Math.min(1, p.w / 1.8), .025, .045], [p.x, y, .25], brass, .009);
        this.box(this.fixture, [.035,.025,.24], [p.x, y, .12], brass);
      }
    }
    this.invalidate();
  }
  /** The selected artwork's mark when there are several: a thin band on the wall around it (never in photos or films). */
  private outline(w: number, h: number, round: boolean): THREE.Mesh {
    const pad = .03, band = .012;
    let geometry: THREE.BufferGeometry;
    if (round) geometry = new THREE.RingGeometry(w / 2 + pad, w / 2 + pad + band, 96);
    else {
      const shape = outlineRect(w / 2 + pad + band, h / 2 + pad + band);
      shape.holes.push(outlineRect(w / 2 + pad, h / 2 + pad));
      geometry = new THREE.ShapeGeometry(shape);
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#4c8dff', toneMapped: false }));
    mesh.position.z = -.008; mesh.userData.outline = true; mesh.visible = !this.busy;
    return mesh;
  }
  private outlines(visible: boolean) { this.frames.traverse((o) => { if (o.userData.outline) o.visible = visible; }); }

  // ── tap and drag an artwork ───────────────────────────────────────────────
  private ray(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.raycaster;
  }
  private wallPoint(e: PointerEvent) { return this.ray(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -.03), new THREE.Vector3()); }
  private pointerDown = (e: PointerEvent) => {
    if (this.busy || this.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const [hit] = this.ray(e).intersectObjects(this.frames.children, true);
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && o.parent !== this.frames) o = o.parent;
    const id = o?.userData.id as string | undefined;
    const at = id ? this.placed.get(id) : undefined;
    const start = at ? this.wallPoint(e) : null;
    if (!id || !at || !start) return;
    // The orbit controls ignore this press.
    this.controls.enabled = false;
    this.drag = { id, pointerId: e.pointerId, start, x: at.x, y: at.y, moved: false, offset: null };
    try { this.host.setPointerCapture(e.pointerId); } catch { /* not needed to drag */ }
    if (id !== (this.project.pieceId ?? 'p1')) this.hooks.onSelect?.(id);
  };
  private pointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = this.wallPoint(e), at = this.placed.get(d.id);
    if (!p || !at) return;
    // Kept on the wall: within the room's width (and the 2D views'), above the skirting, below the top.
    const limit = Math.min(this.roomSize / 2 - .2, 2.4);
    const x = at.w / 2 >= limit ? 0 : THREE.MathUtils.clamp(d.x + p.x - d.start.x, -limit + at.w / 2, limit - at.w / 2);
    const y = THREE.MathUtils.clamp(d.y + p.y - d.start.y, .12 + at.h / 2, Math.max(.12 + at.h / 2, this.wallHeight - .12 - at.h / 2));
    if (!d.moved && Math.hypot(x - d.x, y - d.y) < .01) return;
    d.moved = true;
    const group = this.frames.children.find((g) => g.userData.id === d.id);
    if (group) { group.position.x = x; group.position.y = y; }
    d.offset = { x: Math.round(x * 1000) / 10, y: Math.round((y - at.homeY) * 1000) / 10 };
    this.invalidate();
  };
  private pointerUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null; this.controls.enabled = true;
    if (d.moved && d.offset) this.hooks.onMove?.(d.id, d.offset);
  };

  // ── photo and film ────────────────────────────────────────────────────────
  /**
   * The view as it is now (same camera, framing, light and colour), at a long
   * edge of `longEdge` px, without the selection mark or any of the page's UI.
   * Rendered in tiles, so a large photo stays within a phone's limits.
   */
  async capture(longEdge: number, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
    if (this.busy || this.disposed) throw new Error('busy');
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio();
    const aspect = size.x / Math.max(1, size.y);
    const W = Math.round(aspect >= 1 ? longEdge : longEdge * aspect), H = Math.round(aspect >= 1 ? longEdge / aspect : longEdge);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('canvas');
    const tile = Math.min(1024, this.renderer.capabilities.maxTextureSize);
    this.busy = true; this.outlines(false);
    try {
      this.renderer.setPixelRatio(1);
      for (let y = 0; y < H; y += tile) for (let x = 0; x < W; x += tile) {
        const w = Math.min(tile, W - x), h = Math.min(tile, H - y);
        this.renderer.setSize(w, h, false);
        this.camera.setViewOffset(W, H, x, y, w, h);
        this.renderer.render(this.scene, this.camera);
        ctx.drawImage(this.renderer.domElement, 0, 0, w, h, x, y, w, h);
      }
    } finally {
      this.camera.clearViewOffset();
      this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false);
      this.outlines(true); this.busy = false;
      this.renderer.render(this.scene, this.camera);
      this.fit();
    }
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), type, .92));
  }
  private animate(ms: number, frame: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = (now: number) => {
        if (this.disposed) return resolve();
        const p = Math.min(1, Math.max(0, (now - t0) / ms));
        frame(p);
        if (p < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }
  /**
   * A short film for presenting the work: the camera first glides to face the
   * artworks, then sweeps a slow ~110° arc around them, always looking at
   * them, inside the room and above the sofa. Recorded in the browser.
   */
  async record({ type, longEdge, seconds = 7, onProgress }: { type: string; longEdge: number; seconds?: number; onProgress?: (p: number) => void }): Promise<Blob> {
    if (this.busy || this.disposed) throw new Error('busy');
    this.busy = true; this.controls.enabled = false; this.outlines(false);
    const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio();
    const aspect = size.x / Math.max(1, size.y);
    const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
    const W = even(aspect >= 1 ? longEdge : longEdge * aspect), H = even(aspect >= 1 ? longEdge / aspect : longEdge);
    const u = this.union;
    const target = new THREE.Vector3(u.x, u.y, 0);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const half = THREE.MathUtils.degToRad(55);
    const fit = Math.max(u.h / 2 / Math.tan(vfov / 2), u.w / 2 / Math.tan(hfov / 2)) * 1.55;
    const inRoom = (this.roomSize / 2 - .4 - Math.abs(u.x)) / Math.sin(half);
    const d = THREE.MathUtils.clamp(fit, .7, Math.max(.7, Math.min(inRoom, 5.5)));
    const y = THREE.MathUtils.clamp(u.y, this.sofaHeight + .35, this.wallHeight - .25);
    const at = (theta: number) => new THREE.Vector3(u.x + d * Math.sin(theta), y, d * Math.cos(theta));
    let recorder: MediaRecorder | null = null, stream: MediaStream | null = null;
    try {
      this.renderer.setPixelRatio(1); this.renderer.setSize(W, H, false);
      // First, centre on the artwork.
      const from = this.camera.position.clone(), look = this.controls.target.clone(), toLook = look.clone(), start = at(-half);
      await this.animate(900, (p) => {
        const e = ease(p);
        this.camera.position.lerpVectors(from, start, e); look.lerpVectors(toLook, target, e); this.camera.lookAt(look);
        this.renderer.render(this.scene, this.camera);
      });
      if (this.disposed) throw new Error('closed');
      // The room's own canvas is filmed (it is never covered by the page's buttons, which are not in it).
      const draw = () => this.renderer.render(this.scene, this.camera);
      draw();
      stream = this.renderer.domElement.captureStream(30);
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: W * H > 1.2e6 ? 10_000_000 : 6_000_000 });
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise<void>((resolve) => { recorder!.onstop = () => resolve(); });
      recorder.start(1000);
      await this.animate(seconds * 1000, (p) => {
        this.camera.position.copy(at(-half + 2 * half * ease(p))); this.camera.lookAt(target);
        draw(); onProgress?.(p);
      });
      await this.animate(300, draw);
      if (this.disposed) throw new Error('closed');
      recorder.stop(); await stopped;
      return new Blob(chunks, { type: type.split(';')[0] });
    } finally {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stream?.getTracks().forEach((t) => t.stop());
      this.busy = false;
      if (!this.disposed) {
        this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false);
        this.controls.target.copy(target); this.controls.enabled = true; this.controls.update();
        this.outlines(true); this.fit(); this.invalidate();
      }
    }
  }
  reset = () => {
    this.controls.target.set(0, Math.max(1.15, this.centerY - .65), .05);
    const distance = Math.max(5.2, this.radius * 3.5);
    this.controls.maxDistance = Math.max(8, distance * 1.6);
    this.camera.position.set(distance * .33, Math.max(1.7, this.centerY + .3), distance);
    this.controls.update(); this.invalidate();
  };
  inspect = () => {
    const { x, y, radius } = this.focus;
    this.controls.target.set(x, y, .04);
    this.camera.position.set(x + Math.max(.45, radius * 1.4), y + .12, Math.max(.65, radius * 2.7));
    this.controls.update(); this.invalidate();
  };
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.resize.disconnect(); this.observer.disconnect(); this.controls.dispose();
    document.removeEventListener('visibilitychange', this.visibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.host.removeEventListener('pointerdown', this.pointerDown, { capture: true });
    this.host.removeEventListener('pointermove', this.pointerMove);
    this.host.removeEventListener('pointerup', this.pointerUp);
    this.host.removeEventListener('pointercancel', this.pointerUp);
    disposeObject(this.scene, true); this.artTextures.forEach((t) => t.dispose()); this.wood.dispose(); this.plaster.dispose(); this.textures.forEach(t => t.dispose()); this.env.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
