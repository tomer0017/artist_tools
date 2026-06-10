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
  mode?: 'grayscale' | 'color' | 'painter';
  levels?: number;
  focus?: 'none' | 'shadow' | 'highlight' | 'squint';
}

export interface SampledColor {
  id: string;
  hex: string;
  rgb: { r: number; g: number; b: number };
  createdAt: number;
}

export type InteractionMode = 'idle' | 'crop' | 'calibrate' | 'measure' | 'select' | 'eyedropper' | 'pan';
export type TabId = 'measure' | 'value' | 'color' | 'grid';

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

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'general', name: 'General Structure', visible: true, color: '#f59e0b' },
  { id: 'eyes', name: 'Eyes', visible: true, color: '#3b82f6' },
  { id: 'nose', name: 'Nose', visible: true, color: '#10b981' },
  { id: 'mouth', name: 'Mouth', visible: true, color: '#ef4444' },
  { id: 'jaw', name: 'Jaw / Chin', visible: true, color: '#8b5cf6' },
  { id: 'hair', name: 'Hair / Outline', visible: true, color: '#ec4899' },
];

export const DEFAULT_VALUE_SETTINGS: ValueSettings = {
  grayscale: false,
  posterize: 0,
  contrast: 100,
  brightness: 100,
  mode: 'color',
  levels: 5,
  focus: 'none',
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
