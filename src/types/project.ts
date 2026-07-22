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
  // Sketch mode only: 0 = simple (few strong contours) → 100 = detailed
  // (more secondary edges). A painter-facing control that hides the underlying
  // edge threshold / blur tuning. Default 50 = balanced construction drawing.
  sketchDetail?: number;
}

export interface SampledColor {
  id: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  createdAt: number;
}

export type InteractionMode = 'idle' | 'crop' | 'calibrate' | 'measure' | 'select' | 'eyedropper' | 'pan';
export type TabId = 'measure' | 'value' | 'color' | 'grid' | 'compare';

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
};

export interface ProjectData {
  image: string | null;
  calibration: CalibrationLine | null;
  measurements: MeasurementLine[];
  layers: Layer[];
  activeLayerId: string;
  valueSettings: ValueSettings;
  sampledColors: SampledColor[];
  gridSettings: GridSettings;
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
  sketchDetail: 50,
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
