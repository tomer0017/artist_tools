export interface Point {
  x: number;
  y: number;
}

export interface MeasurementLine {
  id: string;
  start: Point;
  end: Point;
  label: string;
  color: string;
  layerId: string;
  visible: boolean;
}

export interface CalibrationLine {
  start: Point;
  end: Point;
  realWorldSize: number;
  unit: string;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  color: string;
}

export interface ValueSettings {
  grayscale: boolean;
  posterize: number;
  contrast: number;
  brightness: number;
  mode?: 'grayscale' | 'color' | 'painter' | 'sketch';
  levels?: number;
  focus?: 'none' | 'shadow' | 'highlight' | 'squint';
  // Sketch mode: which of the two styles is shown, and each style's own
  // controls (0–100, 50 = default). See src/lib/sketch/styles.ts.
  sketchStyle?: SketchStyleId;
  sketchOutline?: SketchOutlineSettings;
  sketchPencil?: SketchPencilSettings;
  // Legacy Sketch fields: the black-and-white vector trace's controls (until
  // November 2026) and, before them, sketchDetail / sketchShading. Kept so
  // projects saved with them still load and keep them; the current Sketch
  // ignores them.
  sketchTrace?: SketchTraceSettings;
  sketchDetail?: number;
  sketchShading?: boolean;
}

/** Clean Outline or Pencil Study. */
export type SketchStyleId = 'outline' | 'pencil';

export interface SketchOutlineSettings {
  /** Finer ← 50 → bolder lines. */
  lineWeight: number;
  /** Main contours only ← 50 → every faint edge. */
  detail: number;
}

export interface SketchPencilSettings extends SketchOutlineSettings {
  /** Lighter ← 50 → deeper graphite. */
  shading: number;
}

export const DEFAULT_SKETCH_OUTLINE: SketchOutlineSettings = { lineWeight: 50, detail: 50 };
export const DEFAULT_SKETCH_PENCIL: SketchPencilSettings = { lineWeight: 50, detail: 50, shading: 50 };

/** Legacy: the retired black-and-white trace's controls, as older projects saved them. */
export interface SketchTraceSettings {
  ink: number;
  detail: number;
  separation: number;
  invert: boolean;
  smoothing: number;
  local: number;
  simplify: number;
  corners: number;
}

export interface SampledColor {
  id: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  createdAt: number;
}

export type InteractionMode = 'idle' | 'crop' | 'calibrate' | 'measure' | 'select' | 'eyedropper' | 'pan';
export type TabId = 'measure' | 'value' | 'color' | 'grid' | 'compare' | 'wall';
// What the navigation bars link to: the Home tool hub and the tools.
export type NavViewId = 'home' | TabId;
// Everything the app can show: those, plus the account and plans pages.
export type ViewId = NavViewId | 'profile' | 'plans' | 'learn';

/** Quarter turns of the image on the grid, clockwise; the image itself is never changed. */
export type GridRotation = 0 | 90 | 180 | 270;
/** Columns × rows dividing the canvas evenly, or square cells of a size in the canvas unit. */
export type GridCellMode = 'divisions' | 'square';

export interface GridSettings {
  canvasWidth: number;
  canvasHeight: number;
  unit: 'cm' | 'in';
  columns: number;
  rows: number;
  lineColor: string;
  lineOpacity: number;
  lineWidth: number;
  imageOffsetX: number;
  imageOffsetY: number;
  imageScale: number;
  // Since M1 (2026-11): optional in saved projects, read with the defaults
  // below (normalizeGridSettings), so a grid saved before opens exactly as it was.
  rotation: GridRotation;
  cellMode: GridCellMode;
  /** Side of a square cell, in `unit` (square cells only). */
  cellSize: number;
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  canvasWidth: 50,
  canvasHeight: 70,
  unit: 'cm',
  columns: 4,
  rows: 4,
  lineColor: '#ffffff',
  lineOpacity: 0.5,
  lineWidth: 1,
  imageOffsetX: 0,
  imageOffsetY: 0,
  imageScale: 1,
  rotation: 0,
  cellMode: 'divisions',
  cellSize: 3,
};

/**
 * Grid settings as saved, made complete: only the settings added since M1 get
 * their defaults (or replace an unusable value); everything a grid saved
 * earlier holds is kept exactly as it is, so it draws and exports as before.
 */
export function normalizeGridSettings(saved: unknown): GridSettings {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULT_GRID_SETTINGS };
  const s = saved as Partial<GridSettings>;
  return {
    ...(s as GridSettings),
    rotation: s.rotation === 90 || s.rotation === 180 || s.rotation === 270 ? s.rotation : 0,
    cellMode: s.cellMode === 'square' ? 'square' : 'divisions',
    cellSize: typeof s.cellSize === 'number' && Number.isFinite(s.cellSize) && s.cellSize > 0 ? s.cellSize : DEFAULT_GRID_SETTINGS.cellSize,
  };
}

export interface ProjectData {
  image: string | null;
  calibration: CalibrationLine | null;
  measurements: MeasurementLine[];
  layers: Layer[];
  activeLayerId: string;
  valueSettings: ValueSettings;
  sampledColors: SampledColor[];
  gridSettings: GridSettings;
  // The Grid tool owns its own working image, initialized once from the main
  // reference and independent thereafter. Optional for backward compatibility
  // with projects saved before Grid became an independent document.
  gridImage?: string | null;
  gridImageInitialized?: boolean;
  // A picture handed over from a Learn exercise or challenge (ADR-0018): the
  // item's ID, so whatever is saved from it asks the server whether that item
  // is still open to the account. Cleared when the picture is replaced.
  imageLearnItem?: string | null;
  gridImageLearnItem?: string | null;
  savedAt: number;
}

// Palette that user-created layers cycle through (by index). These are the
// colors the original fixed anatomical layers used, so existing projects and
// newly-added layers stay visually consistent.
export const LAYER_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

// Measurement-line color swatches, shared by the desktop toolbar and the mobile
// line-color picker so both surfaces offer the exact same options.
export const LINE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#ffffff', '#94a3b8'];

// A brand-new project starts with a single, generically-named layer (the app is
// a general proportion tool, not face-specific). NOTE: this default only seeds
// newProject()/initial state when nothing is persisted — existing saved
// projects keep whatever layers they stored, untouched, for backward compat.
export const DEFAULT_LAYERS: Layer[] = [
  { id: 'general', name: 'General Lines', visible: true, color: LAYER_COLORS[0] },
];

export const DEFAULT_VALUE_SETTINGS: ValueSettings = {
  grayscale: false,
  posterize: 0,
  contrast: 100,
  brightness: 100,
  mode: 'color',
  // 9 value groups is the painter-friendly default (general painting precision);
  // users can still drop to 3/5/7 for composition/block-in or push to 11/13.
  levels: 9,
  focus: 'none',
  sketchStyle: 'outline',
};

export const genId = () => Math.random().toString(36).slice(2, 10);

export function distanceBetween(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export function angleBetween(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Format a measurement line's length in real-world units using the calibration
// reference. Returns an em-dash when there's no usable calibration. Shared by
// every Measure surface (desktop canvas, panel, mobile) so the result is
// always identical.
export function realWorldLength(
  line: Pick<MeasurementLine, 'start' | 'end'>,
  calibration: CalibrationLine | null,
): string {
  if (!calibration) return '—';
  const calDist = distanceBetween(calibration.start, calibration.end);
  if (calDist === 0) return '—';
  const scale = calibration.realWorldSize / calDist;
  return (distanceBetween(line.start, line.end) * scale).toFixed(1) + ' ' + calibration.unit;
}
