import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildArtwork } from './artwork';
import { roomOf, isRound, type WallProject } from '../types';
import { SOFAS } from '../render/room';
import { sofaScaleOf } from '../render/interior';
import { frameGeometry } from '../render/frame';

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
  private frame = new THREE.Group();
  private architecture = new THREE.Group();
  private sofa: THREE.Group | null = null;
  private project: WallProject;
  private art: HTMLCanvasElement;
  private artTexture: THREE.CanvasTexture;
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
  
  constructor(private host: HTMLElement, project: WallProject, art: HTMLCanvasElement, private status: (state: 'ready' | 'error') => void) {
    this.project = project; this.art = art;
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
    this.artTexture = this.makeArtTexture(art);
    this.wallMaterial = new THREE.MeshStandardMaterial({ color: '#e4ded2', roughness: .93, bumpMap: this.plaster, bumpScale: .004 });
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: '#d8c0a1', roughness: .65 });
    this.scene.add(this.architecture, this.frame, this.fixture, this.fill, this.key, this.picture, this.picture.target);
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
    this.resize = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (w < 1 || h < 1) return;
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.invalidate();
    });
    this.resize.observe(host);
    this.observer = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; if (this.visible) this.invalidate(); });
    this.observer.observe(host);
    document.addEventListener('visibilitychange', this.visibility);
    this.update(project, art); this.reset();
    void this.load();
  }
  private makeArtTexture(art: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(art); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); return t;
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.status('error'); };
  private visibility = () => { if (!document.hidden) this.invalidate(); };
  private invalidate = () => {
    if (this.disposed || this.raf || !this.visible || document.hidden) return;
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
      const [gltf, color, normal, rough] = await Promise.all([
        new GLTFLoader().loadAsync('/models/art-wall/sofa/sofa.gltf'),
        loader.loadAsync('/models/art-wall/floor-color.jpg'), loader.loadAsync('/models/art-wall/floor-normal.jpg'), loader.loadAsync('/models/art-wall/floor-rough.jpg'),
      ]);
      if (this.disposed) { disposeObject(gltf.scene, true); [color, normal, rough].forEach(t => t.dispose()); return; }
      this.textures.push(color, normal, rough);
      color.colorSpace = THREE.SRGBColorSpace;
      [color, normal, rough].forEach(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 5); t.anisotropy = 4; });
      this.floorMaterial.map = color; this.floorMaterial.normalMap = normal; this.floorMaterial.roughnessMap = rough; this.floorMaterial.normalScale.set(.35,.35); this.floorMaterial.needsUpdate = true;
      this.sofa = gltf.scene;
      this.sofa.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = o.receiveShadow = true;
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
      this.scene.add(this.sofa); this.update(this.project, this.art); this.status('ready');
    } catch { if (!this.disposed) this.status('error'); }
  }
  update(project: WallProject, art: HTMLCanvasElement) {
    this.project = project;
    if (this.art !== art) { this.artTexture.dispose(); this.art = art; this.artTexture = this.makeArtTexture(art); }
    const a = project.artwork, f = project.frame;
    const g = frameGeometry(a.widthCm, isRound(a) ? a.widthCm : a.heightCm, f);
    const width = Math.max(6.8, g.outerW / 100 + 2);
    const dims = SOFAS[project.space.room.sofaStyle];
    const sofaWidth = dims.w / 100 * sofaScaleOf(project);
    const sofaHeight = sofaWidth / 1.807 * .7095;
    this.centerY = sofaHeight + project.space.aboveSofaCm / 100 + g.outerH / 200;
    this.radius = Math.max(g.outerW, g.outerH) / 200;
    const height = Math.max(3.3, this.centerY + g.outerH / 200 + .55);
    if (this.roomSize !== width || this.architecture.userData.height !== height) { this.roomSize = width; this.buildRoom(width, height); this.architecture.userData.height = height; }
    const preset = roomOf(project.space.room.id);
    this.wallMaterial.color.set(project.space.mode === 'wall' ? project.space.wall.color : preset.wall.color);
    this.floorMaterial.color.set(project.space.room.id === 'loft' ? '#b7b4af' : '#ffffff');
    this.upholstery.value.set(project.space.room.sofaColor);
    if (this.sofa) { const scale = sofaWidth / 1.807; this.sofa.scale.setScalar(scale); this.sofa.position.set(0, 0, .54 * scale + .07); }
    this.scene.remove(this.frame); disposeObject(this.frame); this.frame = buildArtwork(project, this.artTexture, this.wood);
    this.frame.position.y = this.centerY; this.scene.add(this.frame);
    this.scene.remove(this.fixture); disposeObject(this.fixture); this.fixture = new THREE.Group(); this.scene.add(this.fixture);
    const lightY = this.centerY + g.outerH / 200 + .11;
    const temp = { warm: '#ffdcad', neutral: '#fff4df', cool: '#deebff' }[project.light.temperature];
    this.key.color.set(project.light.enabled ? temp : '#fff1dc');
    this.key.intensity = project.light.enabled ? 1.4 + project.light.intensity / 50 : 3;
    this.fill.intensity = project.light.enabled ? .55 : 1.15;
    this.picture.color.set(temp); this.picture.intensity = project.light.pictureLight ? 3 + project.light.intensity / 8 : 0;
    this.picture.position.set(0, lightY, .28); this.picture.target.position.set(0, this.centerY, 0);
    if (project.light.pictureLight) {
      const brass = new THREE.MeshStandardMaterial({ color: '#b69a5d', metalness: .85, roughness: .25 });
      this.box(this.fixture, [Math.min(1, g.outerW / 180), .025, .045], [0, lightY, .25], brass, .009);
      this.box(this.fixture, [.035,.025,.24], [0, lightY, .12], brass);
    }
    this.invalidate();
  }
  reset = () => {
    this.controls.target.set(0, Math.max(1.15, this.centerY - .65), .05);
    const distance = Math.max(5.2, this.radius * 3.5);
    this.controls.maxDistance = Math.max(8, distance * 1.6);
    this.camera.position.set(distance * .33, Math.max(1.7, this.centerY + .3), distance);
    this.controls.update(); this.invalidate();
  };
  inspect = () => {
    this.controls.target.set(0, this.centerY, .04);
    this.camera.position.set(Math.max(.45, this.radius * 1.4), this.centerY + .12, Math.max(.65, this.radius * 2.7));
    this.controls.update(); this.invalidate();
  };
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.resize.disconnect(); this.observer.disconnect(); this.controls.dispose();
    document.removeEventListener('visibilitychange', this.visibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    disposeObject(this.scene, true); this.artTexture.dispose(); this.wood.dispose(); this.plaster.dispose(); this.textures.forEach(t => t.dispose()); this.env.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
