// Art on Your Wall — the saved project and the options it can use.
//
// A project is plain JSON (versioned) that names its images by id; the images
// themselves (the original artwork file, a room photo) stay in this browser
// (storage.ts), like every other tool's work. `scene` is reserved for what
// comes later (3D rooms, live AR, automatic wall detection), so those can
// read and extend a project without reshaping it.

import type { FeatureId } from '@/lib/plans';

export const PROJECT_SCHEMA = 'sketchyartlab.wall-project' as const;
export const PROJECT_VERSION = 1;

export interface Pt {
  x: number;
  y: number;
}

// ── artwork ─────────────────────────────────────────────────────────────────
export type AspectPreset = 'free' | 'square' | 'circle' | '4:5' | '3:4' | '2:3' | '16:9' | 'custom';
export interface CropSpec {
  aspect: AspectPreset;
  /** The custom ratio, width to height (used when aspect is 'custom'). */
  custom: { w: number; h: number };
  /** Degrees, applied to the whole image before cropping (−180…180). */
  rotation: number;
  /** The crop box in the rotated image's bounding box, 0…1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArtworkSpec {
  /** The original file, kept as it was (storage.ts). */
  imageId: string | null;
  naturalWidth: number;
  naturalHeight: number;
  crop: CropSpec;
  /** Real size in centimetres; a round artwork has both equal to its diameter. */
  widthCm: number;
  heightCm: number;
}

// ── frame ───────────────────────────────────────────────────────────────────
export type FrameType = 'classic' | 'floating' | 'frameless';
export type FinishId = 'white' | 'black' | 'caramel' | 'walnut' | 'silver' | 'lightGold' | 'darkGold';

export interface FrameSpec {
  type: FrameType;
  finish: FinishId;
  /** Moulding face width, cm. */
  widthCm: number;
  /** How far the frame stands off the wall, cm (shadows). */
  depthCm: number;
  /** A floating frame's visible gap around the artwork, cm. */
  gapCm: number;
  mat: { enabled: boolean; widthCm: number; color: string };
}

// ── space ───────────────────────────────────────────────────────────────────
export type SpaceMode = 'wall' | 'room' | 'photo';
export type WallTexture = 'paint' | 'plaster' | 'concrete' | 'limewash' | 'linen' | 'brick' | 'slats';
export type RoomId = 'nordic' | 'warm' | 'loft' | 'salon' | 'coastal';
export type SofaStyle = 'modern' | 'curved' | 'chesterfield' | 'lounge';

export interface PhotoSpec {
  imageId: string | null;
  naturalWidth: number;
  naturalHeight: number;
  /** Two points on the photo (0…1) and the real distance between them. */
  calibration: { a: Pt; b: Pt; cm: number } | null;
  /** Where the framed artwork's corners sit on the photo (0…1): top-left, top-right, bottom-right, bottom-left. */
  quad: [Pt, Pt, Pt, Pt] | null;
  /** The framed piece's height ÷ width, and its width in cm, when the quad was set (a new frame or size follows). */
  quadAspect?: number;
  quadWidthCm?: number;
  /** 0…100 */
  shadow: number;
  /** 0…100: how much the room's light dims the piece (neutral, never a colour change). */
  match: number;
}

export interface SpaceSpec {
  mode: SpaceMode;
  wall: { color: string; texture: WallTexture };
  room: { id: RoomId; sofaStyle: SofaStyle; sofaColor: string };
  /** Wall Studio: how much of the view's width the framed piece takes (0.25…0.8). */
  zoom: number;
  /** Room Studio: the gap between the sofa's back and the frame's bottom edge, cm. */
  aboveSofaCm: number;
  photo: PhotoSpec;
}

// ── light and output ────────────────────────────────────────────────────────
export type LightTemp = 'warm' | 'neutral' | 'cool';
export interface LightSpec {
  enabled: boolean;
  pictureLight: boolean;
  temperature: LightTemp;
  /** 0…100 */
  intensity: number;
}

export type ExportShape = 'landscape' | 'square' | 'portrait';
export interface OutputSpec {
  format: 'jpeg' | 'png';
  size: 'standard' | 'high';
  shape: ExportShape;
}

export interface WallProject {
  schema: typeof PROJECT_SCHEMA;
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  artwork: ArtworkSpec;
  frame: FrameSpec;
  /** Up to four frames to compare side by side. */
  variants: FrameSpec[];
  space: SpaceSpec;
  light: LightSpec;
  output: OutputSpec;
  /** Reserved for later (3D rooms, AR, wall detection): where the piece hangs and how the scene is seen. */
  scene?: { placement?: { wallId?: string; xCm?: number; yCm?: number }; camera?: Record<string, unknown> };
}

// ── option lists ────────────────────────────────────────────────────────────
/** What unlocks an option (the catalog's features, published per plan in Admin → Plans). */
export const WALL_FEATURES = {
  premium: 'wall.premium',
  lighting: 'wall.lighting',
  photo: 'wall.my_room',
  compare: 'wall.compare',
  hires: 'export.wall_hires',
} as const satisfies Record<string, FeatureId>;

export const FRAME_TYPES: { id: FrameType; pro: boolean }[] = [
  { id: 'classic', pro: false },
  { id: 'frameless', pro: false },
  { id: 'floating', pro: true },
];

export interface Finish {
  id: FinishId;
  pro: boolean;
  kind: 'paint' | 'wood' | 'metal';
  /** Base, darker and lighter tones. */
  base: string;
  dark: string;
  light: string;
}

export const FINISHES: Finish[] = [
  { id: 'white', pro: false, kind: 'paint', base: '#efece5', dark: '#d8d3c8', light: '#fbfaf7' },
  { id: 'black', pro: false, kind: 'paint', base: '#1c1b1a', dark: '#0e0d0d', light: '#3a3836' },
  { id: 'caramel', pro: false, kind: 'wood', base: '#b0743c', dark: '#7d4f25', light: '#d29a5f' },
  { id: 'walnut', pro: true, kind: 'wood', base: '#4b3021', dark: '#2b1a11', light: '#6e4a33' },
  { id: 'silver', pro: true, kind: 'metal', base: '#b9bdc3', dark: '#80858c', light: '#eef0f2' },
  { id: 'lightGold', pro: true, kind: 'metal', base: '#d6bd86', dark: '#a98a52', light: '#f6e8c4' },
  { id: 'darkGold', pro: true, kind: 'metal', base: '#9b7837', dark: '#634a1f', light: '#d2b26b' },
];
export const finishOf = (id: FinishId): Finish => FINISHES.find((f) => f.id === id) ?? FINISHES[0];

export const MAT_COLORS = ['#f6f3ec', '#ece3d2', '#d8d5cf', '#22211f'];

export const WALL_TEXTURES: { id: WallTexture; pro: boolean }[] = [
  { id: 'paint', pro: false },
  { id: 'plaster', pro: false },
  { id: 'concrete', pro: true },
  { id: 'limewash', pro: true },
  { id: 'linen', pro: true },
  { id: 'brick', pro: true },
  { id: 'slats', pro: true },
];

export const WALL_COLORS = ['#f4f1ea', '#e9e3d8', '#d9d2c5', '#c9c4bb', '#a7a39b', '#6f7a74', '#41524a', '#2f3a4a', '#7a4f3f', '#1f1f22'];

export interface RoomPreset {
  id: RoomId;
  wall: { color: string; texture: WallTexture };
  floor: { kind: 'wood' | 'concrete'; color: string; dark: string; plankCm: number };
  baseboard: string;
  wainscot: boolean;
  rug: { color: string; border: string } | null;
  sofa: { style: SofaStyle; color: string };
  decor: 'plant' | 'lamp' | 'vase' | 'none';
}

export const ROOMS: RoomPreset[] = [
  { id: 'nordic', wall: { color: '#ece8e0', texture: 'paint' }, floor: { kind: 'wood', color: '#c9a57c', dark: '#a8835b', plankCm: 19 }, baseboard: '#f3f0ea', wainscot: false, rug: { color: '#e4ddd0', border: '#cfc5b3' }, sofa: { style: 'modern', color: '#b8b6b0' }, decor: 'plant' },
  { id: 'warm', wall: { color: '#ddd0bf', texture: 'limewash' }, floor: { kind: 'wood', color: '#7a5236', dark: '#5a3a24', plankCm: 21 }, baseboard: '#e3d8c9', wainscot: false, rug: { color: '#c9b9a2', border: '#a89276' }, sofa: { style: 'lounge', color: '#9a5b34' }, decor: 'lamp' },
  { id: 'loft', wall: { color: '#a9a7a2', texture: 'concrete' }, floor: { kind: 'concrete', color: '#5d5b58', dark: '#4a4846', plankCm: 0 }, baseboard: '#8f8d88', wainscot: false, rug: null, sofa: { style: 'modern', color: '#232222' }, decor: 'vase' },
  { id: 'salon', wall: { color: '#3f5547', texture: 'paint' }, floor: { kind: 'wood', color: '#8a5f3b', dark: '#69452a', plankCm: 14 }, baseboard: '#3a4f42', wainscot: true, rug: { color: '#8c3b33', border: '#d8b98a' }, sofa: { style: 'chesterfield', color: '#c99b8f' }, decor: 'lamp' },
  { id: 'coastal', wall: { color: '#d7dee0', texture: 'plaster' }, floor: { kind: 'wood', color: '#d8cfc2', dark: '#bdb2a3', plankCm: 20 }, baseboard: '#eef1f1', wainscot: false, rug: { color: '#eae6dc', border: '#9fb0b8' }, sofa: { style: 'curved', color: '#ece6da' }, decor: 'plant' },
];
export const roomOf = (id: RoomId): RoomPreset => ROOMS.find((r) => r.id === id) ?? ROOMS[0];

export const SOFA_STYLES: SofaStyle[] = ['modern', 'curved', 'chesterfield', 'lounge'];
export const SOFA_COLORS = ['#b8b6b0', '#ece6da', '#232222', '#9a5b34', '#c99b8f', '#3f5a74', '#5e6b4f', '#b5873f'];

export const ASPECTS: { id: AspectPreset; ratio: number | null }[] = [
  { id: 'free', ratio: null },
  { id: 'square', ratio: 1 },
  { id: 'circle', ratio: 1 },
  { id: '4:5', ratio: 4 / 5 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '2:3', ratio: 2 / 3 },
  { id: '16:9', ratio: 16 / 9 },
  { id: 'custom', ratio: null },
];

/** The crop's width-to-height ratio in the image's pixels, when the preset fixes one. */
export function aspectRatioOf(crop: CropSpec): number | null {
  if (crop.aspect === 'custom') return crop.custom.w > 0 && crop.custom.h > 0 ? crop.custom.w / crop.custom.h : null;
  return ASPECTS.find((a) => a.id === crop.aspect)?.ratio ?? null;
}

export const isRound = (artwork: ArtworkSpec): boolean => artwork.crop.aspect === 'circle';

export const SHAPES: Record<ExportShape, number> = { landscape: 3 / 2, square: 1, portrait: 4 / 5 };
/** Longest side of a saved image. */
export const EXPORT_PX = { standard: 1600, high: 4200 } as const;

// ── defaults ────────────────────────────────────────────────────────────────
export const DEFAULT_FRAME: FrameSpec = {
  type: 'classic',
  finish: 'black',
  widthCm: 2.5,
  depthCm: 3,
  gapCm: 1,
  mat: { enabled: true, widthCm: 6, color: MAT_COLORS[0] },
};

export function newProject(id: string, name: string, now = Date.now()): WallProject {
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    artwork: {
      imageId: null,
      naturalWidth: 0,
      naturalHeight: 0,
      crop: { aspect: 'free', custom: { w: 3, h: 2 }, rotation: 0, x: 0, y: 0, w: 1, h: 1 },
      widthCm: 50,
      heightCm: 40,
    },
    frame: { ...DEFAULT_FRAME, mat: { ...DEFAULT_FRAME.mat } },
    variants: [],
    space: {
      mode: 'wall',
      wall: { color: WALL_COLORS[1], texture: 'plaster' },
      room: { id: 'nordic', sofaStyle: 'modern', sofaColor: ROOMS[0].sofa.color },
      zoom: 0.42,
      aboveSofaCm: 24,
      photo: { imageId: null, naturalWidth: 0, naturalHeight: 0, calibration: null, quad: null, shadow: 55, match: 30 },
    },
    light: { enabled: false, pictureLight: false, temperature: 'warm', intensity: 60 },
    output: { format: 'jpeg', size: 'standard', shape: 'landscape' },
  };
}

/** A project read back from storage, with anything missing filled in (older or partial saves). */
export function normalizeProject(raw: Partial<WallProject> & { id: string }): WallProject {
  const base = newProject(raw.id, raw.name ?? 'Untitled', raw.createdAt ?? Date.now());
  const artwork = { ...base.artwork, ...raw.artwork, crop: { ...base.artwork.crop, ...raw.artwork?.crop } };
  const frame = { ...base.frame, ...raw.frame, mat: { ...base.frame.mat, ...raw.frame?.mat } };
  const space: SpaceSpec = {
    ...base.space,
    ...raw.space,
    wall: { ...base.space.wall, ...raw.space?.wall },
    room: { ...base.space.room, ...raw.space?.room },
    photo: { ...base.space.photo, ...raw.space?.photo },
  };
  return {
    ...base,
    ...raw,
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    artwork,
    frame,
    variants: (raw.variants ?? []).slice(0, 4).map((v) => ({ ...base.frame, ...v, mat: { ...base.frame.mat, ...v.mat } })),
    space,
    light: { ...base.light, ...raw.light },
    output: { ...base.output, ...raw.output },
  };
}
