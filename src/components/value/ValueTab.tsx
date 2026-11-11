import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'use-intl';
import { useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import ImageUploader from '@/components/common/ImageUploader';
import {
  Sun, Moon, Eye, Palette as PaletteIcon, Brush, Layers,
  SlidersHorizontal, X, Maximize2, Minimize2, Download, Image as ImageIcon,
  Contrast, PencilLine, ChevronDown, RotateCcw, Replace,
} from 'lucide-react';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { dataUrlToBlob } from '@/lib/saveMedia';
import {
  buildTraceSource, traceImage, renderTraceToCanvas, traceToSvg,
  TRACE_PRESETS, type TraceSource, type TraceResult,
} from '@/lib/sketch';
import { DEFAULT_SKETCH_TRACE, type SketchTraceSettings } from '@/types/project';
import Slider from '@/components/common/Slider';
import ToolHeader from '@/components/shell/ToolHeader';
import ToolEmptyState from '@/components/shell/ToolEmptyState';
import { PortraitArt } from '@/components/shell/ToolArt';

type Mode = 'grayscale' | 'color' | 'painter' | 'sketch';
type Focus = 'none' | 'shadow' | 'highlight' | 'squint';
type PaletteView = 'dominant' | 'value' | 'mix';
type HueFamily =
  | 'red' | 'orange' | 'yellow' | 'green' | 'cyan'
  | 'blue' | 'purple' | 'magenta' | 'skin' | 'neutral';

interface ValueGroup {
  index: number;
  rangeMin: number;
  rangeMax: number;
  avgR: number;
  avgG: number;
  avgB: number;
  count: number;
  pct: number;
  hex: string;
  hsl: { h: number; s: number; l: number };
  warmth: 'warm' | 'cool' | 'neutral';
  paintHint: string;
}

interface DominantSwatch {
  key: string;
  family: HueFamily;
  valueBand: 'dark' | 'mid' | 'light';
  hex: string;
  hsl: { h: number; s: number; l: number };
  avgR: number;
  avgG: number;
  avgB: number;
  count: number;
  pct: number;
  label: string;
  warmth: 'warm' | 'cool' | 'neutral';
  paintHint: string;
}

const MAX_PROCESS_DIM = 900; // cap processing for mobile perf

function rgbToHex(r: number, g: number, b: number) {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function classifyWarmth(h: number, s: number): 'warm' | 'cool' | 'neutral' {
  if (s < 8) return 'neutral';
  if (h >= 0 && h <= 60) return 'warm';
  if (h >= 300) return 'warm';
  if (h >= 180 && h < 300) return 'cool';
  return 'warm';
}

function paintHint(hsl: { h: number; s: number; l: number }, warmth: string, brightnessLabel: string) {
  const { h, s, l } = hsl;
  if (s < 8) {
    if (l < 20) return 'Ivory black + raw umber';
    if (l < 50) return 'Neutral gray (titanium + ivory black)';
    if (l < 80) return 'Titanium white + warm gray';
    return 'Pure titanium white';
  }
  let family = 'mixed earth';
  if (h < 20 || h >= 340) family = warmth === 'warm' ? 'cadmium red + burnt sienna' : 'alizarin crimson';
  else if (h < 45) family = 'burnt sienna + yellow ochre';
  else if (h < 70) family = 'yellow ochre + cadmium yellow';
  else if (h < 160) family = 'sap green + yellow ochre';
  else if (h < 200) family = 'cerulean + viridian';
  else if (h < 260) family = 'ultramarine + payne\u2019s gray';
  else family = 'dioxazine purple + alizarin';
  if (l < 25) family += ' + ivory black';
  else if (l > 75) family += ' + titanium white';
  return family;
}

function brightnessLabel(l: number) {
  if (l < 15) return 'darkest';
  if (l < 35) return 'dark';
  if (l < 65) return 'mid';
  if (l < 85) return 'light';
  return 'highlight';
}

function hueFamily(h: number, s: number, l: number): HueFamily {
  // Treat very low saturation as neutral (gray family)
  if (s < 12) return 'neutral';
  // Skin/warm-neutral cluster (heuristic, broad)
  if (h >= 5 && h <= 45 && s >= 10 && s <= 60 && l >= 28 && l <= 85) return 'skin';
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'cyan';
  if (h < 250) return 'blue';
  if (h < 290) return 'purple';
  return 'magenta';
}

function valueBand(l: number): 'dark' | 'mid' | 'light' {
  if (l < 35) return 'dark';
  if (l < 68) return 'mid';
  return 'light';
}

const FAMILY_LABEL: Record<HueFamily, string> = {
  red: 'red', orange: 'orange', yellow: 'yellow', green: 'green',
  cyan: 'teal', blue: 'blue', purple: 'purple', magenta: 'magenta',
  skin: 'skin', neutral: 'neutral',
};

// A dominant colour's name as message keys (studyTool.colors), so the screen
// can name it in the studio's language. The study sheet draws the English
// name from dominantLabel below.
type NamedColor =
  | 'deepBlack' | 'darkNeutral' | 'midGray' | 'lightGray' | 'nearWhite'
  | 'skinShadow' | 'skinMidtone' | 'skinHighlight'
  | 'darkOlive' | 'lightOlive' | 'oliveGreen';
type DominantName =
  | { named: NamedColor }
  | { hue: Exclude<HueFamily, 'skin' | 'neutral'>; tone: 'dark' | 'light' | null; muted: boolean };

const NAMED_LABEL: Record<NamedColor, string> = {
  deepBlack: 'deep black', darkNeutral: 'dark neutral', midGray: 'mid gray',
  lightGray: 'light gray', nearWhite: 'near white',
  skinShadow: 'skin shadow', skinMidtone: 'skin midtone', skinHighlight: 'skin highlight',
  darkOlive: 'dark olive', lightOlive: 'light olive', oliveGreen: 'olive green',
};

function dominantName(fam: HueFamily, band: 'dark' | 'mid' | 'light', hsl: { h: number; s: number; l: number }): DominantName {
  if (fam === 'neutral') {
    if (hsl.l < 12) return { named: 'deepBlack' };
    if (hsl.l < 32) return { named: 'darkNeutral' };
    if (hsl.l < 60) return { named: 'midGray' };
    if (hsl.l < 85) return { named: 'lightGray' };
    return { named: 'nearWhite' };
  }
  if (fam === 'skin') {
    return { named: band === 'dark' ? 'skinShadow' : band === 'mid' ? 'skinMidtone' : 'skinHighlight' };
  }
  // Special-case olive (yellow-green low saturation)
  if (fam === 'green' && hsl.h < 90 && hsl.s < 45) {
    return { named: band === 'dark' ? 'darkOlive' : band === 'light' ? 'lightOlive' : 'oliveGreen' };
  }
  return { hue: fam, tone: band === 'dark' ? 'dark' : band === 'light' ? 'light' : null, muted: hsl.s < 32 };
}

// The English name (drawn into the study sheet).
function dominantLabel(fam: HueFamily, band: 'dark' | 'mid' | 'light', hsl: { h: number; s: number; l: number }) {
  const name = dominantName(fam, band, hsl);
  if ('named' in name) return NAMED_LABEL[name.named];
  const muted = name.muted ? 'muted ' : '';
  const adj = name.tone === 'dark' ? 'dark ' : name.tone === 'light' ? 'light ' : '';
  return `${adj}${muted}${FAMILY_LABEL[name.hue]}`.trim();
}

export default function ValueTab() {
  const { image, valueSettings, setValueSettings } = useProject();
  const { save } = useSaveMedia();
  const t = useTranslations('studyTool');
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [groups, setGroups] = useState<ValueGroup[]>([]);
  const [dominant, setDominant] = useState<DominantSwatch[]>([]);
  const [paletteView, setPaletteView] = useState<PaletteView>('dominant');
  const [isolatedIdx, setIsolatedIdx] = useState<number | null>(null);
  const [showMobileControls, setShowMobileControls] = useState(false);
  const [mobileView, setMobileView] = useState<'processed' | 'original' | 'palette'>('processed');
  const [compareSlider, setCompareSlider] = useState(50);
  const [showCompare, setShowCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<'slider' | 'side'>('slider');
  const [fullscreen, setFullscreen] = useState(false);
  const [showMoreTrace, setShowMoreTrace] = useState(false);
  // True only while a slider thumb is down. Drives the interactive (lower
  // resolution) render so the preview keeps up with the finger; the moment the
  // finger lifts, the same composition is re-rendered at full quality.
  const [scrubbing, setScrubbing] = useState(false);
  const [traceStats, setTraceStats] = useState({ threshold: 0, minShapePx: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Grayscale conversion depends only on the pixels, so it is cached across
  // control changes; the trace itself re-runs on every one of them.
  const traceCache = useRef<{
    image: string; contrast: number; brightness: number; w: number; h: number;
    source: TraceSource;
  } | null>(null);
  // Kept so "Save SVG" exports exactly the paths on screen.
  const traceResult = useRef<TraceResult | null>(null);
  const isMobile = useIsMobile();

  const activeImage = localImage || image;

  // Migrate legacy fields into the unified mode/levels model on first load
  const mode: Mode = (valueSettings.mode as Mode) || (valueSettings.grayscale ? 'grayscale' : 'color');
  const levels: number = valueSettings.levels ?? (valueSettings.posterize > 0 ? valueSettings.posterize : 9);
  const focus: Focus = (valueSettings.focus as Focus) || 'none';
  const contrast = valueSettings.contrast;
  const brightness = valueSettings.brightness;
  const trace: SketchTraceSettings = { ...DEFAULT_SKETCH_TRACE, ...valueSettings.sketchTrace };
  const setTrace = (patch: Partial<SketchTraceSettings>) =>
    setValueSettings({ sketchTrace: { ...trace, ...patch } });

  const updateMode = (m: Mode) => setValueSettings({ mode: m, grayscale: m === 'grayscale' });
  const updateLevels = (l: number) => setValueSettings({ levels: l, posterize: l });
  const updateFocus = (f: Focus) => setValueSettings({ focus: f });

  const processImage = useCallback(() => {
    if (!activeImage || !canvasRef.current) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = (e) => {
      console.error('[ValueTab] Failed to load image for processing:', e);
    };
    img.onload = () => {
      try {
      const canvas = canvasRef.current!;
      // Cap dimensions for performance
      const scale = Math.min(1, MAX_PROCESS_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      // Pre-blur reduces noisy speckle so palette quantization yields clean masses.
      // Sketch deliberately gets none: the sketch engine runs its own
      // edge-preserving denoise, and a plain Gaussian here would soften exactly
      // the boundaries it needs to keep sharp.
      const blur = focus === 'squint' ? 5 : mode === 'painter' ? 2.5 : mode === 'sketch' ? 0 : mode === 'color' ? 1.2 : 0;
      // NOTE: iOS Safari historically ignores ctx.filter for contrast()/brightness(),
      // so applying them via CSS filter silently no-ops on iPhone. Apply them
      // manually below to guarantee identical behavior across desktop and mobile.
      ctx.filter = blur ? `blur(${blur}px)` : 'none';
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = 'none';

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      // Contrast: standard per-channel LUT around 127.5.
      // Brightness: hue-preserving — operate on HSL lightness so bright greens
      // stay green (don't drift to gray/khaki), skin highlights migrate toward
      // lighter skin instead of washing to neutral. This matters for painters
      // studying value structure without losing the subject's color family.
      const bMul = brightness / 100;
      const cMul = contrast / 100;
      if (cMul !== 1) {
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) {
          const nv = (v - 127.5) * cMul + 127.5;
          lut[v] = nv < 0 ? 0 : nv > 255 ? 255 : nv;
        }
        for (let i = 0; i < data.length; i += 4) {
          data[i] = lut[data[i]];
          data[i + 1] = lut[data[i + 1]];
          data[i + 2] = lut[data[i + 2]];
        }
      }
      if (bMul !== 1) {
        // Move HSL lightness toward 0 (k<1) or toward 1 (k>1) while preserving
        // hue. Saturation is preserved except very near white, where we ease it
        // down to avoid neon edges. Keeps painter-friendly color relationships.
        const k = bMul;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const l = (max + min) / 2;
          const d = max - min;
          let h = 0, s = 0;
          if (d !== 0) {
            s = d / (1 - Math.abs(2 * l - 1));
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
          }
          let l2 = k <= 1 ? l * k : 1 - (1 - l) / k;
          if (l2 > 1) l2 = 1; else if (l2 < 0) l2 = 0;
          let s2 = s;
          if (l2 > 0.9) s2 = s * Math.max(0, 1 - (l2 - 0.9) / 0.1 * 0.5);
          // HSL -> RGB
          const c = (1 - Math.abs(2 * l2 - 1)) * s2;
          const hp = h / 60;
          const x = c * (1 - Math.abs((hp % 2) - 1));
          let r1 = 0, g1 = 0, b1 = 0;
          if (s2 === 0) { r1 = g1 = b1 = 0; }
          else if (hp < 1) { r1 = c; g1 = x; }
          else if (hp < 2) { r1 = x; g1 = c; }
          else if (hp < 3) { g1 = c; b1 = x; }
          else if (hp < 4) { g1 = x; b1 = c; }
          else if (hp < 5) { r1 = x; b1 = c; }
          else { r1 = c; b1 = x; }
          const m = l2 - c / 2;
          const R = (r1 + m) * 255, G = (g1 + m) * 255, B = (b1 + m) * 255;
          data[i] = R < 0 ? 0 : R > 255 ? 255 : R;
          data[i + 1] = G < 0 ? 0 : G > 255 ? 255 : G;
          data[i + 2] = B < 0 ? 0 : B > 255 ? 255 : B;
        }
      }
      const total = w * h;

      // Pass 1: assign each pixel to a luminance bin and accumulate avg color (in original color)
      const bins = levels;
      const sumR = new Array(bins).fill(0);
      const sumG = new Array(bins).fill(0);
      const sumB = new Array(bins).fill(0);
      const count = new Array(bins).fill(0);
      const binAssign = new Uint8Array(total);

      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b; // 0..255
        let bin = Math.floor((lum / 256) * bins);
        if (bin >= bins) bin = bins - 1;
        binAssign[p] = bin;
        sumR[bin] += r; sumG[bin] += g; sumB[bin] += b; count[bin]++;
      }

      // === Dominant palette extraction ===
      // Sample at most ~40k pixels for performance, classify each by hue-family + value band.
      const targetSamples = 40000;
      const stride = Math.max(1, Math.floor(total / targetSamples));
      const buckets = new Map<string, {
        family: HueFamily; band: 'dark' | 'mid' | 'light';
        sumR: number; sumG: number; sumB: number; count: number;
      }>();
      let sampledTotal = 0;
      for (let p = 0; p < total; p += stride) {
        const i = p * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const hsl = rgbToHsl(r, g, b);
        // Drop near-white / near-black noise unless it dominates (we'll still capture neutral darks)
        if (hsl.l < 4 || hsl.l > 97) continue;
        const fam = hueFamily(hsl.h, hsl.s, hsl.l);
        const band = valueBand(hsl.l);
        const key = `${fam}-${band}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { family: fam, band, sumR: 0, sumG: 0, sumB: 0, count: 0 };
          buckets.set(key, bucket);
        }
        bucket.sumR += r; bucket.sumG += g; bucket.sumB += b; bucket.count++;
        sampledTotal++;
      }

      let domList: DominantSwatch[] = [];
      buckets.forEach((b, key) => {
        const pct = sampledTotal ? (b.count / sampledTotal) * 100 : 0;
        const r = b.sumR / b.count, g = b.sumG / b.count, bl = b.sumB / b.count;
        const hsl = rgbToHsl(r, g, bl);
        const warmth = classifyWarmth(hsl.h, hsl.s);
        domList.push({
          key, family: b.family, valueBand: b.band,
          hex: rgbToHex(r, g, bl), hsl,
          avgR: r, avgG: g, avgB: bl, count: b.count, pct,
          label: dominantLabel(b.family, b.band, hsl),
          warmth,
          paintHint: paintHint(hsl, warmth, brightnessLabel(hsl.l)),
        });
      });

      // Importance: coverage, but boost saturated hues so they aren't drowned by neutrals
      domList.sort((a, b) => {
        const sa = a.pct * (a.family === 'neutral' ? 0.7 : 1) * (1 + Math.min(a.hsl.s, 80) / 200);
        const sb = b.pct * (b.family === 'neutral' ? 0.7 : 1) * (1 + Math.min(b.hsl.s, 80) / 200);
        return sb - sa;
      });
      // Drop tiny noisy clusters but keep top 5 minimum
      const filtered = domList.filter((d, i) => i < 5 || d.pct >= 1.2);
      // Cap palette size; tie loosely to user's value-levels choice so the processed
      // image and the palette stay in sync (more levels = richer reconstruction).
      const paletteSize = Math.min(9, Math.max(5, levels + 1));
      domList = filtered.slice(0, paletteSize);
      // Re-sort visually: dark -> light within importance
      domList.sort((a, b) => a.hsl.l - b.hsl.l);
      setDominant(domList);

      // Build a flat palette array for nearest-color quantization in pass 2.
      // Distance is computed in a perceptual-ish space: luminance weighted heavier
      // than hue so warm/cool separation is preserved without value bands bleeding.
      const paletteRGB = domList.map(d => ({
        r: d.avgR, g: d.avgG, b: d.avgB,
        // precompute luminance for weighting
        L: 0.299 * d.avgR + 0.587 * d.avgG + 0.114 * d.avgB,
        h: d.hsl.h,
        s: d.hsl.s,
      }));

      // Compute per-bin average colors
      const avg: { r: number; g: number; b: number }[] = [];
      for (let bi = 0; bi < bins; bi++) {
        if (count[bi] === 0) {
          // Use bin midpoint gray as fallback
          const mid = (bi + 0.5) * (255 / bins);
          avg.push({ r: mid, g: mid, b: mid });
        } else {
          avg.push({ r: sumR[bi] / count[bi], g: sumG[bi] / count[bi], b: sumB[bi] / count[bi] });
        }
      }

      // Pass 2: write output pixels based on mode and focus
      const focusKeep = (binIdx: number): number => {
        if (focus === 'shadow') return binIdx < bins / 2 ? 1 : 0.18;
        if (focus === 'highlight') return binIdx >= bins / 2 ? 1 : 0.18;
        return 1;
      };

      if (mode === 'sketch') {
        // === Sketch mode: a deterministic black & white vector trace ===
        // src/lib/sketch/trace.ts is a filter, not an interpretation: the same
        // pixels and the same settings always produce the same paths. It makes
        // no judgement about faces, subjects or importance — how much black,
        // how much simplification and how much detail survives are the
        // operator's calls, on the controls below the image.
        //
        // Rendered as PNG: JPEG ringing along a hard black/white boundary is
        // very visible and would read as noise the artist has to filter out.
        const cached = traceCache.current;
        const source =
          cached && cached.image === activeImage && cached.contrast === contrast &&
          cached.brightness === brightness && cached.w === w && cached.h === h
            ? cached.source
            : buildTraceSource({ data, width: w, height: h });
        traceCache.current = { image: activeImage, contrast, brightness, w, h, source };
        const result = traceImage(source, trace);
        traceResult.current = result;
        setTraceStats({ threshold: result.stats.threshold, minShapePx: result.stats.minShapePx });
        // While a control is under the finger the preview is rendered at 1×;
        // on release the same paths are re-rendered at 2×. Only the resolution
        // changes, never the composition, so the picture does not appear to
        // shift as the drag ends.
        renderTraceToCanvas(result, canvas, { scale: scrubbing ? 1 : 2 });
        setProcessedUrl(canvas.toDataURL('image/png'));
        // Fall through below to build the value/dominant palettes (still useful
        // reference while drawing), then skip the palette-quantization loop.
      } else {
      const usePalette = (mode === 'color' || mode === 'painter') && paletteRGB.length > 0;
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const bi = binAssign[p];
        let r: number, g: number, b: number;
        if (mode === 'grayscale') {
          const gray = (bi + 0.5) * (255 / bins);
          r = g = b = gray;
        } else if (usePalette) {
          // Quantize this pixel to the nearest dominant palette color.
          // Weighted RGB distance plus a luminance term so values don't collapse.
          const sr = data[i], sg = data[i + 1], sb = data[i + 2];
          const sL = 0.299 * sr + 0.587 * sg + 0.114 * sb;
          // Hue-aware term: when the source pixel carries real chroma, prefer
          // palette colors with a similar hue. Without this, warm browns / skin
          // / beige tones often snap to a slightly magenta palette neighbor
          // because RGB distance alone is hue-blind.
          const sHsl = rgbToHsl(sr, sg, sb);
          const sHue = sHsl.h, sSat = sHsl.s;
          // Only apply when source has noticeable saturation; neutrals stay untouched.
          const hueWeight = sSat < 10 ? 0 : Math.min(1, (sSat - 10) / 40);
          let best = 0, bestD = Infinity;
          for (let k = 0; k < paletteRGB.length; k++) {
            const pc = paletteRGB[k];
            const dr = sr - pc.r, dg = sg - pc.g, db = sb - pc.b;
            const dL = sL - pc.L;
            // Weighted: emphasize green (perceptual) + luminance separation
            let d = dr * dr * 0.6 + dg * dg * 1.0 + db * db * 0.5 + dL * dL * 1.4;
            if (hueWeight > 0 && pc.s > 6) {
              // Circular hue distance in degrees (0..180)
              let dh = Math.abs(sHue - pc.h);
              if (dh > 180) dh = 360 - dh;
              // Extra penalty for the warm→magenta drift specifically:
              // source in warm/skin range (orange-red) being matched to a
              // magenta/purple candidate (h ~ 280-340).
              const sourceWarm = (sHue <= 50 || sHue >= 350);
              const candMagenta = pc.h >= 280 && pc.h <= 345;
              const driftPenalty = sourceWarm && candMagenta ? 2.2 : 1;
              // Scale into the same units as the squared RGB terms.
              d += hueWeight * driftPenalty * dh * dh * 6;
            }
            if (d < bestD) { bestD = d; best = k; }
          }
          const pc = paletteRGB[best];
          r = pc.r; g = pc.g; b = pc.b;
          if (mode === 'painter') {
            // Painter mode: nudge slightly toward a softer, gouache-like rendering
            const hsl = rgbToHsl(r, g, b);
            const out = hslToRgb(hsl.h, Math.max(0, hsl.s - 10), hsl.l);
            r = out.r; g = out.g; b = out.b;
          }
        } else {
          // Fallback (no palette yet): bin average
          const c = avg[bi];
          r = c.r; g = c.g; b = c.b;
        }
        const k = focusKeep(bi);
        if (k < 1) {
          // Fade non-focus regions toward a neutral mid-gray
          const mid = 60;
          r = r * k + mid * (1 - k);
          g = g * k + mid * (1 - k);
          b = b * k + mid * (1 - k);
        }
        // Isolation: hide non-isolated bins
        if (isolatedIdx !== null && bi !== isolatedIdx) {
          r = 18; g = 18; b = 22;
        }
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      }

      ctx.putImageData(imageData, 0, 0);
      setProcessedUrl(canvas.toDataURL('image/jpeg', 0.9));
      }

      // Build groups
      const newGroups: ValueGroup[] = [];
      for (let bi = 0; bi < bins; bi++) {
        const a = avg[bi];
        const hsl = rgbToHsl(a.r, a.g, a.b);
        const warmth = classifyWarmth(hsl.h, hsl.s);
        newGroups.push({
          index: bi,
          rangeMin: Math.round((bi / bins) * 100),
          rangeMax: Math.round(((bi + 1) / bins) * 100),
          avgR: a.r, avgG: a.g, avgB: a.b,
          count: count[bi],
          pct: (count[bi] / total) * 100,
          hex: rgbToHex(a.r, a.g, a.b),
          hsl,
          warmth,
          paintHint: paintHint(hsl, warmth, brightnessLabel(hsl.l)),
        });
      }
      setGroups(newGroups);
      } catch (error) {
        console.error('[ValueTab] Failed to process image (canvas pipeline):', error);
      }
    };
    img.src = activeImage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImage, mode, levels, focus, contrast, brightness, isolatedIdx,
    trace.ink, trace.detail, trace.separation, trace.invert, trace.smoothing,
    trace.local, trace.simplify, trace.corners, scrubbing]);

  // Coalesce the burst of events a slider drag produces into one pass. The
  // delay is short enough to still feel like the image updates as you drag,
  // but stops the (heavier) sketch pipeline from queuing up per-pixel ticks.
  useEffect(() => {
    const id = window.setTimeout(processImage, 60);
    return () => window.clearTimeout(id);
  }, [processImage]);

  const dominantWarmth = useMemo(() => {
    if (!groups.length) return 'neutral';
    const counts = { warm: 0, cool: 0, neutral: 0 };
    groups.forEach(g => { counts[g.warmth] += g.pct; });
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as 'warm' | 'cool' | 'neutral';
  }, [groups]);

  const saveDataUrl = (dataUrl: string, name: string, mime: string) => {
    dataUrlToBlob(dataUrl)
      .then((blob) => save({ blob, filename: name, mime, title: t('save.imageTitle') }))
      .catch((error) => console.error('[ValueTab] Failed to prepare image for saving:', error));
  };

  const exportProcessed = () => {
    if (!processedUrl) return;
    // Sketch output is line art on white — it is rendered and saved as PNG so
    // the lines stay crisp for tracing / transferring.
    if (mode === 'sketch') saveDataUrl(processedUrl, 'sketch.png', 'image/png');
    else saveDataUrl(processedUrl, 'value-study.jpg', 'image/jpeg');
  };

  // The trace is polygons all the way down, so the SVG is the same paths as the
  // screen rather than a re-trace of the bitmap — scalable for large-format
  // printing.
  const exportSketchSvg = () => {
    const result = traceResult.current;
    if (!result) return;
    try {
      const blob = new Blob([traceToSvg(result)], { type: 'image/svg+xml' });
      save({ blob, filename: 'sketch.svg', mime: 'image/svg+xml', title: t('save.svgTitle') });
    } catch (error) {
      console.error('[ValueTab] Failed to export sketch SVG:', error);
    }
  };

  const exportPalette = () => {
    if (!groups.length) return;
    try {
    const w = 1200, swatchH = 220, labelH = 80;
    const c = document.createElement('canvas');
    c.width = w; c.height = swatchH + labelH;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#15151a';
    ctx.fillRect(0, 0, c.width, c.height);
    const sw = w / groups.length;
    groups.forEach((g, i) => {
      ctx.fillStyle = g.hex;
      ctx.fillRect(i * sw, 0, sw, swatchH);
      ctx.fillStyle = '#e8e6df';
      ctx.font = 'bold 18px Inter, sans-serif';
      ctx.fillText(g.hex.toUpperCase(), i * sw + 14, swatchH + 28);
      ctx.fillStyle = '#a0a0a8';
      ctx.font = '13px Inter, sans-serif';
      ctx.fillText(`${g.pct.toFixed(1)}% • ${brightnessLabel(g.hsl.l)}`, i * sw + 14, swatchH + 50);
    });
    saveDataUrl(c.toDataURL('image/png'), 'value-palette.png', 'image/png');
    } catch (error) {
      console.error('[ValueTab] Failed to export value palette:', error);
    }
  };

  const exportStudySheet = async () => {
    if (!activeImage || !processedUrl || !groups.length) return;
    try {
    const W = 1600, pad = 40, gap = 24, headerH = 60, stripH = 60, paletteH = 110, domH = 150;
    const orig = new Image(); const proc = new Image();
    orig.crossOrigin = 'anonymous'; proc.crossOrigin = 'anonymous';
    await Promise.all([
      new Promise<void>((res, rej) => { orig.onload = () => res(); orig.onerror = () => rej(new Error('original image failed to load')); orig.src = activeImage; }),
      new Promise<void>((res, rej) => { proc.onload = () => res(); proc.onerror = () => rej(new Error('processed image failed to load')); proc.src = processedUrl; }),
    ]);
    const imgAreaW = (W - pad * 2 - gap) / 2;
    const ratio = orig.naturalHeight / orig.naturalWidth;
    const imgH = imgAreaW * ratio;
    const H = headerH + imgH + gap + stripH + gap + paletteH + gap + domH + pad * 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#15151a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e8e6df';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.fillText('Value Study', pad, pad + 24);
    ctx.fillStyle = '#888';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText(`${mode} • ${levels} values • dominant ${dominantWarmth}`, pad, pad + 44);
    const yImg = pad + headerH;
    ctx.drawImage(orig, pad, yImg, imgAreaW, imgH);
    ctx.drawImage(proc, pad + imgAreaW + gap, yImg, imgAreaW, imgH);
    // Strip
    const yStrip = yImg + imgH + gap;
    let x = pad;
    const usable = W - pad * 2;
    groups.forEach(g => {
      const w2 = Math.max(8, (g.pct / 100) * usable);
      ctx.fillStyle = g.hex; ctx.fillRect(x, yStrip, w2, stripH);
      x += w2;
    });
    // Value palette rows
    const yPal = yStrip + stripH + gap;
    ctx.fillStyle = '#e8e6df';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText('VALUE PALETTE', pad, yPal - 8);
    const sw = (W - pad * 2) / groups.length;
    groups.forEach((g, i) => {
      ctx.fillStyle = g.hex;
      ctx.fillRect(pad + i * sw, yPal, sw - 6, 50);
      ctx.fillStyle = '#e8e6df';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.fillText(g.hex.toUpperCase(), pad + i * sw + 6, yPal + 72);
      ctx.fillStyle = '#888';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`${g.pct.toFixed(1)}% • ${brightnessLabel(g.hsl.l)}`, pad + i * sw + 6, yPal + 90);
    });
    // Dominant palette rows
    const yDom = yPal + paletteH + gap;
    ctx.fillStyle = '#e8e6df';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText('DOMINANT COLORS', pad, yDom - 8);
    const dn = Math.max(1, dominant.length);
    const dsw = (W - pad * 2) / dn;
    dominant.forEach((d, i) => {
      ctx.fillStyle = d.hex;
      ctx.fillRect(pad + i * dsw, yDom, dsw - 6, 70);
      ctx.fillStyle = '#e8e6df';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText(d.label, pad + i * dsw + 6, yDom + 92);
      ctx.fillStyle = '#888';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`${d.hex.toUpperCase()} • ${d.pct.toFixed(1)}%`, pad + i * dsw + 6, yDom + 110);
      ctx.font = 'italic 10px Inter, sans-serif';
      ctx.fillText(d.paintHint.slice(0, 38), pad + i * dsw + 6, yDom + 128);
    });
    saveDataUrl(c.toDataURL('image/png'), 'value-study-sheet.png', 'image/png');
    } catch (error) {
      console.error('[ValueTab] Failed to export value study sheet:', error);
    }
  };

  if (!activeImage) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <ToolHeader tool="value" task={t('empty.task')} />
        <ToolEmptyState
          tool="value"
          heading={t('empty.heading')}
          steps={[
            t('empty.step1'),
            t('empty.step2'),
            t('empty.step3'),
          ]}
          note={t('empty.note')}
        >
          <ImageUploader primary label={t('empty.upload')} onImageLoad={setLocalImage} />
        </ToolEmptyState>
      </div>
    );
  }

  // === Reusable subcomponents ===

  // The three study modes answer three different questions:
  //   Color  → which colors should I mix?
  //   Values → where are the lights and shadows?
  //   Sketch → where should I draw?
  // Painter is treated as a color-rendering variant, so it highlights "Color".
  const studyModes = ([
    { id: 'color' as Mode, label: t('modes.color.label'), icon: <PaletteIcon className="w-3.5 h-3.5" /> },
    { id: 'grayscale' as Mode, label: t('modes.grayscale.label'), icon: <Contrast className="w-3.5 h-3.5" /> },
    { id: 'sketch' as Mode, label: t('modes.sketch.label'), icon: <PencilLine className="w-3.5 h-3.5" /> },
  ]);
  const studyModeActive = (id: Mode) =>
    id === 'color' ? (mode === 'color' || mode === 'painter') : mode === id;
  // The three studies as picture cards, always visible above the image, so
  // the difference between them is clear *before* choosing — no guessing from
  // an icon. `layout="column"` stacks them in the desktop sidebar.
  const STUDY_MODE_INFO: Record<string, { caption: string; treatment: 'flat' | 'values' | 'sketch'; task: string; example: string }> = {
    color: { caption: t('modes.color.caption'), treatment: 'flat', task: t('modes.color.task'), example: t('modes.color.example') },
    grayscale: { caption: t('modes.grayscale.caption'), treatment: 'values', task: t('modes.grayscale.task'), example: t('modes.grayscale.example') },
    sketch: { caption: t('modes.sketch.caption'), treatment: 'sketch', task: t('modes.sketch.task'), example: t('modes.sketch.example') },
  };
  const studyTask = STUDY_MODE_INFO[mode === 'painter' ? 'color' : mode]?.task;
  const StudyModeCards = ({ layout }: { layout: 'row' | 'column' }) => (
    <div data-onboarding="value-modes" role="radiogroup" aria-label={t('modes.group')}
      className={layout === 'row' ? 'grid grid-cols-3 gap-2' : 'flex flex-col gap-1.5'}>
      {studyModes.map(m => {
        const info = STUDY_MODE_INFO[m.id];
        const active = studyModeActive(m.id);
        return (
          <button key={m.id} role="radio" aria-checked={active}
            onClick={() => updateMode(m.id === 'color' && mode === 'painter' ? 'painter' : m.id)}
            className={`flex min-w-0 items-center gap-1.5 rounded-xl border p-1.5 text-start md:gap-2 transition-colors ${
              active ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
            }`}>
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg md:h-10 md:w-10">
              <PortraitArt treatment={info.treatment} viewBox="30 26 40 40" label={info.example} />
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-[13px] font-semibold leading-tight ${active ? 'text-primary' : 'text-foreground'}`}>{m.label}</span>
              <span className="block text-[10px] leading-tight text-muted-foreground md:text-[11px]">{info.caption}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  // Painter stays inside the sheet — it's an advanced rendering variant, not
  // switched frequently while painting. Toggling flips between color and painter.
  const PainterToggle = (
    <button onClick={() => updateMode(mode === 'painter' ? 'color' : 'painter')}
      className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-[11px] font-medium transition-colors ${
        mode === 'painter' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}>
      <Brush className="w-3.5 h-3.5" />
      {mode === 'painter' ? t('controls.painterOn') : t('controls.painterOff')}
    </button>
  );

  const LevelButtons = (
    <div data-onboarding="value-levels">
      <div className="flex gap-1">
        {[3, 5, 7, 9, 11, 13].map(l => (
          <button key={l} onClick={() => updateLevels(l)}
            title={l === 9 ? t('levels.recommended') : undefined}
            className={`relative flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
              levels === l
                ? 'bg-primary text-primary-foreground'
                : l === 9
                  ? 'bg-secondary text-secondary-foreground ring-1 ring-primary/50 hover:bg-secondary/80'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}>
            {l}
            {l === 9 && (
              <span className="absolute -top-1 -end-1 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>
      <p className="text-[9px] text-muted-foreground mt-1">
        {t('levels.hint')}
      </p>
    </div>
  );

  const FocusButtons = (
    <div className="grid grid-cols-2 gap-1.5">
      {([
        { id: 'none' as Focus, label: t('focus.none'), icon: <Eye className="w-3 h-3" /> },
        { id: 'shadow' as Focus, label: t('focus.shadow'), icon: <Moon className="w-3 h-3" /> },
        { id: 'highlight' as Focus, label: t('focus.highlight'), icon: <Sun className="w-3 h-3" /> },
        { id: 'squint' as Focus, label: t('focus.squint'), icon: <Layers className="w-3 h-3" /> },
      ]).map(f => (
        <button key={f.id} onClick={() => updateFocus(f.id)}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
            focus === f.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          {f.icon}{f.label}
        </button>
      ))}
    </div>
  );

  // Words, not numbers. A painter setting Ink is judging the picture, not
  // reproducing a level — the raw threshold is available under More controls
  // for anyone who does want to reproduce one.
  const bandLabel = (v: number, bands: string[]) =>
    bands[Math.min(bands.length - 1, Math.floor((v / 100) * bands.length))];
  const inkLabel = bandLabel(trace.ink, [
    t('sketch.ink.minimal'), t('sketch.ink.light'), t('sketch.ink.medium'), t('sketch.ink.heavy'), t('sketch.ink.solid'),
  ]);
  const detailLabel = bandLabel(trace.detail, [
    t('sketch.detail.everything'), t('sketch.detail.fine'), t('sketch.detail.clean'), t('sketch.detail.simple'), t('sketch.detail.bold'),
  ]);
  const separationLabel = bandLabel(trace.separation, [
    t('sketch.separation.off'), t('sketch.separation.gentle'), t('sketch.separation.medium'),
    t('sketch.separation.strong'), t('sketch.separation.extreme'),
  ]);
  // The presets come from src/lib/sketch (English labels); named here by id.
  const presetLabels: Record<string, string> = {
    balanced: t('presets.balanced'),
    graphic: t('presets.graphic'),
    rich: t('presets.rich'),
    fine: t('presets.fine'),
  };

  // Names shown on screen follow the studio's language; the exported palette
  // and study sheet keep the English ones (brightnessLabel, dominantLabel).
  const brightnessName = (l: number) => t(`brightness.${brightnessLabel(l)}`);
  const warmthName = (warmth: 'warm' | 'cool' | 'neutral') => t(`warmth.${warmth}`);
  const colorName = (d: DominantSwatch) => {
    const name = dominantName(d.family, d.valueBand, d.hsl);
    if ('named' in name) return t(`colors.${name.named}`);
    let label = t(`colors.hue.${name.hue}`);
    if (name.muted) label = t('colors.muted', { color: label });
    if (name.tone) label = t(`colors.${name.tone}`, { color: label });
    return label;
  };

  // A slider that keeps the preview moving with the finger: `onChange` fires on
  // every pointermove and `onCommit` when it lifts, which is when the
  // full-quality render happens.
  const traceSlider = (
    key: keyof SketchTraceSettings,
    label: string,
    readout: string,
    hint: string,
  ) => (
    <Slider
      label={label}
      value={trace[key] as number}
      min={0}
      max={key === 'local' ? 50 : 100}
      readout={readout}
      hint={hint}
      onChange={(v) => { setScrubbing(true); setTrace({ [key]: v } as Partial<SketchTraceSettings>); }}
      onCommit={() => setScrubbing(false)}
    />
  );

  // Inline controls that live *permanently below the image* — the sliders a
  // painter reaches for constantly while studying, so they never require
  // opening a menu. Context-aware: Color / Values expose Contrast + Brightness
  // (visibility), while Sketch swaps in a single painter-facing "Sketch detail"
  // control that speaks to the artistic result rather than edge thresholds.
  const InlineImageControls = (
    <div data-onboarding="value-inline" className="w-full px-3 py-2 border-t border-border toolbar-surface shrink-0">
      {mode === 'sketch' ? (
        // Ink and Detail are the two controls a vector trace is actually
        // steered with, so they live permanently under the image and never
        // require opening a panel.
        <div className="flex flex-col sm:flex-row sm:gap-6">
          <div className="flex-1 min-w-0">
            {traceSlider('ink', t('sketch.ink.label'), inkLabel, t('sketch.ink.hint'))}
          </div>
          <div className="flex-1 min-w-0">
            {traceSlider('detail', t('sketch.detail.label'), detailLabel, t('sketch.detail.hint'))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-6">
          <div className="flex-1 min-w-0">
            <Slider label={t('controls.contrast')} value={contrast} min={50} max={200} readout={`${contrast}%`}
              onChange={(v) => setValueSettings({ contrast: v })} />
          </div>
          <div className="flex-1 min-w-0">
            <Slider label={t('controls.brightness')} value={brightness} min={50} max={200} readout={`${brightness}%`}
              onChange={(v) => setValueSettings({ brightness: v })} />
          </div>
        </div>
      )}
    </div>
  );

  // Only expose controls meaningful for the active study mode:
  //   • Painter is a color-rendering variant → shown only in the Color family.
  //   • Focus (shadows / lights / squint) has no effect on the Sketch pass →
  //     hidden in Sketch so the sheet never offers a dead control.
  //   • Contrast / Brightness (or Sketch detail) live inline below the image,
  //     not in this sheet.
  const isColorFamily = mode === 'color' || mode === 'painter';
  const isSketch = mode === 'sketch';
  const ControlsBlock = (
    <div className="space-y-4">
      <div>
        {isColorFamily && (
          <>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('controls.colorRendering')}</p>
            {PainterToggle}
          </>
        )}
        {isSketch && (
          <p className="text-[10px] text-muted-foreground">
            {t('sketch.about')}
          </p>
        )}
      </div>
      {isSketch ? (
        <>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{t('presets.title')}</p>
              <button onClick={() => setTrace(DEFAULT_SKETCH_TRACE)}
                className="flex items-center gap-1 text-[10px] text-primary hover:underline min-h-[44px] px-1">
                <RotateCcw className="w-3 h-3" />{t('presets.reset')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {TRACE_PRESETS.map((preset) => (
                <button key={preset.id} onClick={() => setTrace(preset.settings)}
                  className="py-2 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
                  {presetLabels[preset.id] ?? preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <button onClick={() => setShowMoreTrace((v) => !v)}
              aria-expanded={showMoreTrace}
              className="w-full flex items-center justify-between py-2 min-h-[44px] text-[11px] font-medium text-foreground">
              <span>{t('sketch.more')}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showMoreTrace ? 'rotate-180' : ''}`} />
            </button>
            {showMoreTrace && (
              <div className="space-y-2 pt-1">
                {traceSlider('separation', t('sketch.separation.label'), separationLabel,
                  t('sketch.separation.hint'))}
                <button onClick={() => setTrace({ invert: !trace.invert })}
                  className={`w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded-md text-[11px] font-medium transition-colors ${
                    trace.invert ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}>
                  <Contrast className="w-3.5 h-3.5" />
                  {trace.invert ? t('sketch.invertOn') : t('sketch.invertOff')}
                </button>
                <button onClick={exportSketchSvg}
                  className="w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded-md text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
                  <Download className="w-3.5 h-3.5" />{t('save.svg')}
                </button>

                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold pt-2">{t('sketch.advanced')}</p>
                {traceSlider('smoothing', t('sketch.smoothing.label'), String(trace.smoothing),
                  t('sketch.smoothing.hint'))}
                {traceSlider('local', t('sketch.local.label'), trace.local === 0 ? t('sketch.local.global') : `${trace.local}%`,
                  t('sketch.local.hint'))}
                {traceSlider('simplify', t('sketch.simplify.label'), String(trace.simplify),
                  t('sketch.simplify.hint'))}
                {traceSlider('corners', t('sketch.corners.label'), String(trace.corners),
                  t('sketch.corners.hint'))}
                <p className="text-[9px] text-muted-foreground">
                  {t(trace.local > 0 ? 'sketch.statsLocal' : 'sketch.stats', {
                    threshold: String(traceStats.threshold),
                    minShape: String(traceStats.minShapePx),
                  })}
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('levels.title')}</p>
          {LevelButtons}
        </div>
      )}
      {!isSketch && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('focus.title')}</p>
          {FocusButtons}
        </div>
      )}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('compare.title')}</p>
        <div className="flex gap-1.5">
          <button onClick={() => { setShowCompare(true); setCompareMode('slider'); }}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              showCompare && compareMode === 'slider' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>{t('compare.slider')}</button>
          <button onClick={() => { setShowCompare(true); setCompareMode('side'); }}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              showCompare && compareMode === 'side' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>{t('compare.side')}</button>
          <button onClick={() => setShowCompare(false)}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              !showCompare ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>{t('compare.off')}</button>
        </div>
      </div>
      <div data-onboarding="value-save">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('save.title')}</p>
        <div className="grid grid-cols-1 gap-1.5">
          <button onClick={exportProcessed}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />{t('save.processed')}
          </button>
          {isSketch && (
            <button onClick={exportSketchSvg}
              className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
              <Download className="w-3 h-3" />{t('save.svg')}
            </button>
          )}
          <button onClick={exportPalette}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />{t('save.palette')}
          </button>
          <button onClick={exportStudySheet}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />{t('save.sheet')}
          </button>
        </div>
      </div>
      <div className="pt-2 border-t border-border">
        <ImageUploader onImageLoad={setLocalImage} compact />
      </div>
    </div>
  );

  // Both strips are value scales, dark → light from left to right in every
  // language, so they (and their tooltips) stay left to right.
  const DistributionStrip = (
    <div dir="ltr" className="flex w-full h-10 rounded-md overflow-hidden border border-border bg-secondary/40">
      {groups.map(g => (
        <button
          key={g.index}
          onClick={() => setIsolatedIdx(isolatedIdx === g.index ? null : g.index)}
          style={{ flexBasis: `${Math.max(g.pct, 1.5)}%`, backgroundColor: g.hex }}
          className={`relative group transition-all ${isolatedIdx === g.index ? 'ring-2 ring-primary z-10' : ''}`}
          title={t('palette.groupTitle', { brightness: brightnessName(g.hsl.l), pct: g.pct.toFixed(1), hex: g.hex })}
        >
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold opacity-0 group-hover:opacity-100"
            style={{ color: g.hsl.l > 50 ? '#000' : '#fff' }}>
            {g.pct.toFixed(0)}%
          </span>
        </button>
      ))}
    </div>
  );

  const PaletteRows = (
    <div className="divide-y divide-border/60 rounded-md border border-border bg-card/40">
      {groups.map(g => (
        <button key={g.index}
          onClick={() => setIsolatedIdx(isolatedIdx === g.index ? null : g.index)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-start transition-colors hover:bg-secondary/40 ${
            isolatedIdx === g.index ? 'bg-primary/10' : ''
          }`}>
          <span className="w-7 h-7 rounded shrink-0 border border-border/70" style={{ backgroundColor: g.hex }} />
          {/* Colour codes and the (English) paint names stay left to right;
              on right-to-left pages they still sit next to the swatch. */}
          <span dir="ltr" className="text-[10px] font-mono text-foreground w-16 shrink-0 rtl:text-right">{g.hex.toUpperCase()}</span>
          <span className="text-[10px] text-muted-foreground w-20 shrink-0 capitalize">V{g.index + 1} · {brightnessName(g.hsl.l)}</span>
          <span className="text-[10px] text-muted-foreground w-12 shrink-0 tabular-nums">{g.pct.toFixed(1)}%</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
            g.warmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
            : g.warmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
            : 'bg-secondary text-muted-foreground'
          }`}>{warmthName(g.warmth)}</span>
          <span dir="ltr" className="text-[10px] text-muted-foreground/80 italic truncate flex-1 hidden sm:block rtl:text-right">{g.paintHint}</span>
        </button>
      ))}
    </div>
  );

  const DominantRows = (
    <div className="divide-y divide-border/60 rounded-md border border-border bg-card/40">
      {dominant.map(d => (
        <div key={d.key}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-start">
          <span className="w-7 h-7 rounded shrink-0 border border-border/70" style={{ backgroundColor: d.hex }} />
          <span dir="ltr" className="text-[10px] font-mono text-foreground w-16 shrink-0 rtl:text-right">{d.hex.toUpperCase()}</span>
          <span className="text-[10px] text-foreground w-24 shrink-0 capitalize truncate">{colorName(d)}</span>
          <span className="text-[10px] text-muted-foreground w-12 shrink-0 tabular-nums">{d.pct.toFixed(1)}%</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
            d.warmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
            : d.warmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
            : 'bg-secondary text-muted-foreground'
          }`}>{warmthName(d.warmth)}</span>
          <span dir="ltr" className="text-[10px] text-muted-foreground/80 italic truncate flex-1 hidden sm:block rtl:text-right">{d.paintHint}</span>
        </div>
      ))}
      {dominant.length === 0 && (
        <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">{t('palette.analyzing')}</div>
      )}
    </div>
  );

  const MixRows = (
    <div className="space-y-1.5">
      {dominant.map(d => (
        <div key={d.key} className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2 py-2">
          <span className="w-9 h-9 rounded shrink-0 border border-border/70" style={{ backgroundColor: d.hex }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium capitalize">{colorName(d)}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{d.pct.toFixed(1)}%</span>
            </div>
            <p dir="ltr" className="text-[10px] text-muted-foreground italic truncate rtl:text-right">{d.paintHint}</p>
          </div>
        </div>
      ))}
    </div>
  );

  const PaletteTabs = (
    <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5 text-[10px] font-medium">
      {([
        { id: 'dominant' as PaletteView, label: t('palette.dominant') },
        { id: 'value' as PaletteView, label: t('palette.value') },
        { id: 'mix' as PaletteView, label: t('palette.mix') },
      ]).map(tab => (
        <button key={tab.id} onClick={() => setPaletteView(tab.id)}
          className={`px-2.5 py-1 rounded transition-colors ${
            paletteView === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}>{tab.label}</button>
      ))}
    </div>
  );

  const ActivePaletteContent = paletteView === 'value' ? PaletteRows
    : paletteView === 'mix' ? MixRows : DominantRows;

  const DominantStrip = (
    <div dir="ltr" className="flex w-full h-10 rounded-md overflow-hidden border border-border bg-secondary/40">
      {dominant.map(d => (
        <div key={d.key}
          style={{ flexBasis: `${Math.max(d.pct, 2)}%`, backgroundColor: d.hex }}
          title={t('palette.colorTitle', { name: colorName(d), pct: d.pct.toFixed(1), hex: d.hex })}
        />
      ))}
    </div>
  );

  // Replacing the source is a frequent, fundamental action — it belongs on the
  // image, not in an overflow menu. Uses the shared ImageUploader flow (its
  // compact variant is an icon button), so there is exactly one upload
  // implementation in the app.
  const replaceImage = (dataUrl: string) => {
    // Drop every cached derivation of the previous photo before the new one is
    // processed, so nothing stale can survive into the next trace.
    traceCache.current = null;
    traceResult.current = null;
    setLocalImage(dataUrl);
  };
  const ReplaceImageButton = (
    <div className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full
                    bg-card/90 backdrop-blur-sm border border-border shadow-lg"
      title={t('image.replace')}>
      <ImageUploader onImageLoad={replaceImage} compact />
    </div>
  );

  const maxImgH = fullscreen ? 'max-h-[88vh]' : 'max-h-full';
  // The before/after views stay left to right in every language: original on
  // the left, and the slider's divider is positioned from the left edge.
  const ProcessedImage = (
    <div className={`relative w-full h-full flex items-center justify-center ${fullscreen ? 'p-1' : 'p-3'}`}>
      {showCompare && processedUrl && compareMode === 'side' ? (
        <div dir="ltr" className="flex gap-3 w-full h-full items-center justify-center">
          <div className="flex-1 h-full flex flex-col items-center justify-center min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t('image.original')}</p>
            <img src={activeImage} alt={t('image.original')} className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
          </div>
          <div className="flex-1 h-full flex flex-col items-center justify-center min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t('image.processed')}</p>
            <img src={processedUrl} alt={t('image.processed')} className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
          </div>
        </div>
      ) : showCompare && processedUrl && compareMode === 'slider' ? (
        <div dir="ltr" className="relative inline-block max-w-full max-h-full select-none">
          <img src={activeImage} alt={t('image.original')} className={`block max-w-full ${maxImgH} object-contain rounded`} />
          <div className="absolute inset-0 overflow-hidden rounded" style={{ clipPath: `inset(0 0 0 ${compareSlider}%)` }}>
            <img src={processedUrl} alt={t('image.processed')} className={`block max-w-full ${maxImgH} object-contain rounded`} />
          </div>
          <div className="absolute top-0 bottom-0 w-px bg-primary/80 pointer-events-none" style={{ left: `${compareSlider}%` }} />
          <input type="range" min={0} max={100} value={compareSlider}
            onChange={(e) => setCompareSlider(Number(e.target.value))}
            className="absolute inset-x-4 bottom-3 accent-primary" />
        </div>
      ) : (
        processedUrl && <img src={processedUrl} alt={t('image.alt')}
          className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
      )}
      <div className="absolute top-2 end-2 z-20 flex items-center gap-2">
        {ReplaceImageButton}
        <button onClick={() => setFullscreen(v => !v)}
          className="btn-tool bg-card/90 backdrop-blur-sm border border-border min-h-[44px] min-w-[44px]"
          title={fullscreen ? t('image.exitFullscreen') : t('image.fullscreen')}>
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  // === Mobile layout ===
  if (isMobile) {
    // A colour palette has nothing to say about a strictly black-and-white
    // trace, so Sketch drops the whole palette surface — the strip, the tab and
    // the analysis pane — and the preview takes the space back.
    const mobilePane = isSketch && mobileView === 'palette' ? 'processed' : mobileView;
    return (
      <div className="relative flex-1 flex flex-col min-h-0 canvas-area">
        <ToolHeader tool="value" task={studyTask} />
        <div className="shrink-0 border-b border-border toolbar-surface px-2 py-2">
          <StudyModeCards layout="row" />
        </div>
        <div className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center">
          {mobilePane !== 'palette' && (
            <div className="absolute top-2 end-2 z-20">{ReplaceImageButton}</div>
          )}
          {mobilePane === 'original' && <img src={activeImage} alt={t('image.original')} className="max-h-full max-w-full object-contain" />}
          {mobilePane === 'processed' && processedUrl && <img src={processedUrl} alt={t('image.processed')} className="max-h-full max-w-full object-contain" />}
          {mobilePane === 'palette' && (
            <div className="w-full h-full overflow-y-auto p-3 space-y-3">
              <div className="flex items-center justify-between">
                {PaletteTabs}
                <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                  dominantWarmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
                  : dominantWarmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-secondary text-muted-foreground'
                }`}>{warmthName(dominantWarmth)}</span>
              </div>
              {paletteView === 'value' ? DistributionStrip : DominantStrip}
              {ActivePaletteContent}
            </div>
          )}
        </div>

        {/* Always-accessible controls directly below the image (context-aware) */}
        {mobilePane !== 'palette' && InlineImageControls}

        {/* Value distribution strip — meaningless for a black-and-white trace. */}
        {!isSketch && mobilePane !== 'palette' && groups.length > 0 && (
          <div className="px-3 py-2 border-t border-border toolbar-surface">
            {DistributionStrip}
          </div>
        )}

        {/* View switch, settings and the one primary action. */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border toolbar-surface px-2 py-2">
          <div className="flex min-w-0 flex-1 rounded-lg bg-secondary/60 p-0.5" role="group" aria-label={t('view.group')}>
            {(isSketch ? (['original', 'processed'] as const) : (['original', 'processed', 'palette'] as const)).map(v => (
              <button key={v} onClick={() => setMobileView(v)} aria-pressed={mobilePane === v}
                className={`min-h-[40px] min-w-0 flex-1 rounded-md px-1 text-xs font-medium transition-colors ${
                  mobilePane === v ? 'bg-card text-foreground shadow' : 'text-muted-foreground'
                }`}>{v === 'processed' ? t('view.study') : v === 'original' ? t('view.original') : t('view.palette')}</button>
            ))}
          </div>
          <button onClick={() => setShowMobileControls(true)}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-medium text-foreground">
            <SlidersHorizontal className="h-4 w-4" /> {t('controls.adjust')}
          </button>
          <button onClick={exportProcessed} data-onboarding="value-save"
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground">
            <Download className="h-4 w-4" /> {t('save.button')}
          </button>
        </div>

        {showMobileControls && (
          <div className="absolute inset-x-0 bottom-0 z-30 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sticky top-0 bg-card">
              <p className="text-sm font-semibold">{t('controls.adjustTitle')}</p>
              <button onClick={() => setShowMobileControls(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">{ControlsBlock}</div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  // === Desktop layout ===
  return (
    <div className="flex-1 flex flex-col min-h-0">
    <ToolHeader tool="value" task={studyTask} actions={
      <button onClick={exportProcessed}
        className="me-1 flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
        <Download className="h-4 w-4" /> {t('save.study')}
      </button>
    } />
    <div className="flex-1 flex min-h-0">
      {/* Side controls (left, or right in right-to-left languages): the three studies first, settings below. */}
      <aside className="w-64 panel-surface border-e border-border p-4 overflow-y-auto shrink-0 space-y-4">
        <div>
          <h2 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{t('modes.choose')}</h2>
          <StudyModeCards layout="column" />
        </div>
        {ControlsBlock}
      </aside>

      {/* Center: image dominates. In Sketch it takes the palette's space too. */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className={`${isSketch ? 'flex-1' : 'flex-[7]'} canvas-area flex items-center justify-center min-h-0 overflow-hidden`}>
          {ProcessedImage}
        </div>

        {/* Always-accessible visibility controls, permanently below the image */}
        {InlineImageControls}

        {/* Compact palette analysis — fixed footprint, internal scroll. A
            black-and-white trace has no palette to analyse, so Sketch drops the
            whole pane rather than leaving an empty shelf under the image. */}
        {!isSketch && (
        <div className="flex-[3] min-h-[180px] max-h-[34vh] border-t border-border panel-surface px-3 py-2 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {PaletteTabs}
              <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                dominantWarmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
                : dominantWarmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
                : 'bg-secondary text-muted-foreground'
              }`}>{warmthName(dominantWarmth)}</span>
            </div>
            {isolatedIdx !== null && (
              <button onClick={() => setIsolatedIdx(null)}
                className="text-[10px] text-primary hover:underline">{t('palette.clearIsolation')}</button>
            )}
          </div>
          <div className="shrink-0">{paletteView === 'value' ? DistributionStrip : DominantStrip}</div>
          <div className="flex-1 overflow-y-auto">{ActivePaletteContent}</div>
        </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
    </div>
  );
}

function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}