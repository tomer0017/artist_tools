import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import ImageUploader from '@/components/common/ImageUploader';
import {
  Sun, Moon, Eye, Palette as PaletteIcon, Brush, Layers,
  SlidersHorizontal, X, Maximize2, Minimize2, Download, Image as ImageIcon,
} from 'lucide-react';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { dataUrlToBlob } from '@/lib/saveMedia';

type Mode = 'grayscale' | 'color' | 'painter';
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

function dominantLabel(fam: HueFamily, band: 'dark' | 'mid' | 'light', hsl: { h: number; s: number; l: number }) {
  if (fam === 'neutral') {
    if (hsl.l < 12) return 'deep black';
    if (hsl.l < 32) return 'dark neutral';
    if (hsl.l < 60) return 'mid gray';
    if (hsl.l < 85) return 'light gray';
    return 'near white';
  }
  if (fam === 'skin') {
    return band === 'dark' ? 'skin shadow' : band === 'mid' ? 'skin midtone' : 'skin highlight';
  }
  // Special-case olive (yellow-green low saturation)
  if (fam === 'green' && hsl.h < 90 && hsl.s < 45) {
    return band === 'dark' ? 'dark olive' : band === 'light' ? 'light olive' : 'olive green';
  }
  const muted = hsl.s < 32 ? 'muted ' : '';
  const adj = band === 'dark' ? 'dark ' : band === 'light' ? 'light ' : '';
  return `${adj}${muted}${FAMILY_LABEL[fam]}`.trim();
}

export default function ValueTab() {
  const { image, valueSettings, setValueSettings } = useProject();
  const { save } = useSaveMedia();
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [groups, setGroups] = useState<ValueGroup[]>([]);
  const [dominant, setDominant] = useState<DominantSwatch[]>([]);
  const [paletteView, setPaletteView] = useState<PaletteView>('dominant');
  const [isolatedIdx, setIsolatedIdx] = useState<number | null>(null);
  const [showMobileControls, setShowMobileControls] = useState(false);
  const [activeSlider, setActiveSlider] = useState<null | 'contrast' | 'brightness'>(null);
  const [mobileView, setMobileView] = useState<'processed' | 'original' | 'palette'>('processed');
  const [compareSlider, setCompareSlider] = useState(50);
  const [showCompare, setShowCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<'slider' | 'side'>('slider');
  const [fullscreen, setFullscreen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isMobile = useIsMobile();

  const activeImage = localImage || image;

  // Migrate legacy fields into the unified mode/levels model on first load
  const mode: Mode = (valueSettings.mode as Mode) || (valueSettings.grayscale ? 'grayscale' : 'color');
  const levels: number = valueSettings.levels ?? (valueSettings.posterize > 0 ? valueSettings.posterize : 5);
  const focus: Focus = (valueSettings.focus as Focus) || 'none';
  const contrast = valueSettings.contrast;
  const brightness = valueSettings.brightness;

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
      const blur = focus === 'squint' ? 5 : mode === 'painter' ? 2.5 : mode === 'color' ? 1.2 : 0;
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
  }, [activeImage, mode, levels, focus, contrast, brightness, isolatedIdx]);

  useEffect(() => { processImage(); }, [processImage]);

  const dominantWarmth = useMemo(() => {
    if (!groups.length) return 'neutral';
    const counts = { warm: 0, cool: 0, neutral: 0 };
    groups.forEach(g => { counts[g.warmth] += g.pct; });
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as 'warm' | 'cool' | 'neutral';
  }, [groups]);

  const saveDataUrl = (dataUrl: string, name: string, mime: string) => {
    dataUrlToBlob(dataUrl)
      .then((blob) => save({ blob, filename: name, mime, title: 'Save image' }))
      .catch((error) => console.error('[ValueTab] Failed to prepare image for saving:', error));
  };

  const exportProcessed = () => {
    if (!processedUrl) return;
    saveDataUrl(processedUrl, 'value-study.jpg', 'image/jpeg');
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
      <div className="flex-1 flex items-center justify-center p-8 canvas-area">
        <div className="w-full max-w-md">
          <p className="text-sm text-muted-foreground text-center mb-4">
            Upload an image or use the one from the Measure tab
          </p>
          <ImageUploader onImageLoad={setLocalImage} />
        </div>
      </div>
    );
  }

  // === Reusable subcomponents ===
  const ModeButtons = (
    <div className="grid grid-cols-3 gap-1.5">
      {([
        { id: 'color' as Mode, label: 'Color', icon: <PaletteIcon className="w-3.5 h-3.5" /> },
        { id: 'grayscale' as Mode, label: 'Gray', icon: <Moon className="w-3.5 h-3.5" /> },
        { id: 'painter' as Mode, label: 'Painter', icon: <Brush className="w-3.5 h-3.5" /> },
      ]).map(m => (
        <button key={m.id} onClick={() => updateMode(m.id)}
          className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[11px] font-medium transition-colors ${
            mode === m.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          {m.icon}{m.label}
        </button>
      ))}
    </div>
  );

  const LevelButtons = (
    <div className="flex gap-1.5">
      {[3, 5, 7, 9].map(l => (
        <button key={l} onClick={() => updateLevels(l)}
          className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
            levels === l ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          {l}
        </button>
      ))}
    </div>
  );

  const FocusButtons = (
    <div className="grid grid-cols-2 gap-1.5">
      {([
        { id: 'none' as Focus, label: 'All', icon: <Eye className="w-3 h-3" /> },
        { id: 'shadow' as Focus, label: 'Shadows', icon: <Moon className="w-3 h-3" /> },
        { id: 'highlight' as Focus, label: 'Lights', icon: <Sun className="w-3 h-3" /> },
        { id: 'squint' as Focus, label: 'Squint', icon: <Layers className="w-3 h-3" /> },
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

  const sliderActivate = (which: 'contrast' | 'brightness') => {
    if (isMobile) setActiveSlider(which);
  };
  const sliderRelease = () => {
    if (isMobile) setActiveSlider(null);
  };
  const Sliders = (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] text-muted-foreground font-medium block mb-1">Contrast {contrast}%</label>
        <input type="range" min={50} max={200} value={contrast}
          onChange={(e) => setValueSettings({ contrast: Number(e.target.value) })}
          onPointerDown={() => sliderActivate('contrast')}
          onPointerUp={sliderRelease}
          onPointerCancel={sliderRelease}
          onTouchEnd={sliderRelease}
          className="w-full accent-primary" />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground font-medium block mb-1">Brightness {brightness}%</label>
        <input type="range" min={50} max={200} value={brightness}
          onChange={(e) => setValueSettings({ brightness: Number(e.target.value) })}
          onPointerDown={() => sliderActivate('brightness')}
          onPointerUp={sliderRelease}
          onPointerCancel={sliderRelease}
          onTouchEnd={sliderRelease}
          className="w-full accent-primary" />
      </div>
    </div>
  );

  // Minimal slider strip shown on mobile while actively dragging — keeps the
  // image visible behind it so the user can evaluate the effect in real time.
  const MobileSliderFocusBar = activeSlider && (
    <div className="absolute inset-x-0 bottom-0 z-40 px-4 py-3 bg-card/95 backdrop-blur border-t border-border shadow-2xl">
      <label className="text-[11px] text-muted-foreground font-medium block mb-1 capitalize">
        {activeSlider} {activeSlider === 'contrast' ? contrast : brightness}%
      </label>
      <input type="range" min={50} max={200}
        value={activeSlider === 'contrast' ? contrast : brightness}
        onChange={(e) => setValueSettings(
          activeSlider === 'contrast'
            ? { contrast: Number(e.target.value) }
            : { brightness: Number(e.target.value) }
        )}
        onPointerUp={sliderRelease}
        onPointerCancel={sliderRelease}
        onTouchEnd={sliderRelease}
        autoFocus
        className="w-full accent-primary" />
    </div>
  );

  const ControlsBlock = (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Mode</p>
        {ModeButtons}
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Value groups</p>
        {LevelButtons}
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Focus</p>
        {FocusButtons}
      </div>
      <div>{Sliders}</div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Compare</p>
        <div className="flex gap-1.5">
          <button onClick={() => { setShowCompare(true); setCompareMode('slider'); }}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              showCompare && compareMode === 'slider' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>Slider</button>
          <button onClick={() => { setShowCompare(true); setCompareMode('side'); }}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              showCompare && compareMode === 'side' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>Side</button>
          <button onClick={() => setShowCompare(false)}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              !showCompare ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>Off</button>
        </div>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Save</p>
        <div className="grid grid-cols-1 gap-1.5">
          <button onClick={exportProcessed}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />Save processed image
          </button>
          <button onClick={exportPalette}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />Save palette
          </button>
          <button onClick={exportStudySheet}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />Save study sheet
          </button>
        </div>
      </div>
      <div className="pt-2 border-t border-border">
        <ImageUploader onImageLoad={setLocalImage} compact />
      </div>
    </div>
  );

  const DistributionStrip = (
    <div className="flex w-full h-10 rounded-md overflow-hidden border border-border bg-secondary/40">
      {groups.map(g => (
        <button
          key={g.index}
          onClick={() => setIsolatedIdx(isolatedIdx === g.index ? null : g.index)}
          style={{ flexBasis: `${Math.max(g.pct, 1.5)}%`, backgroundColor: g.hex }}
          className={`relative group transition-all ${isolatedIdx === g.index ? 'ring-2 ring-primary z-10' : ''}`}
          title={`${brightnessLabel(g.hsl.l)} • ${g.pct.toFixed(1)}% • ${g.hex}`}
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
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-secondary/40 ${
            isolatedIdx === g.index ? 'bg-primary/10' : ''
          }`}>
          <span className="w-7 h-7 rounded shrink-0 border border-border/70" style={{ backgroundColor: g.hex }} />
          <span className="text-[10px] font-mono text-foreground w-16 shrink-0">{g.hex.toUpperCase()}</span>
          <span className="text-[10px] text-muted-foreground w-20 shrink-0 capitalize">V{g.index + 1} · {brightnessLabel(g.hsl.l)}</span>
          <span className="text-[10px] text-muted-foreground w-12 shrink-0 tabular-nums">{g.pct.toFixed(1)}%</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
            g.warmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
            : g.warmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
            : 'bg-secondary text-muted-foreground'
          }`}>{g.warmth}</span>
          <span className="text-[10px] text-muted-foreground/80 italic truncate flex-1 hidden sm:block">{g.paintHint}</span>
        </button>
      ))}
    </div>
  );

  const DominantRows = (
    <div className="divide-y divide-border/60 rounded-md border border-border bg-card/40">
      {dominant.map(d => (
        <div key={d.key}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left">
          <span className="w-7 h-7 rounded shrink-0 border border-border/70" style={{ backgroundColor: d.hex }} />
          <span className="text-[10px] font-mono text-foreground w-16 shrink-0">{d.hex.toUpperCase()}</span>
          <span className="text-[10px] text-foreground w-24 shrink-0 capitalize truncate">{d.label}</span>
          <span className="text-[10px] text-muted-foreground w-12 shrink-0 tabular-nums">{d.pct.toFixed(1)}%</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
            d.warmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
            : d.warmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
            : 'bg-secondary text-muted-foreground'
          }`}>{d.warmth}</span>
          <span className="text-[10px] text-muted-foreground/80 italic truncate flex-1 hidden sm:block">{d.paintHint}</span>
        </div>
      ))}
      {dominant.length === 0 && (
        <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">Analyzing dominant colors…</div>
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
              <span className="text-[11px] font-medium capitalize">{d.label}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{d.pct.toFixed(1)}%</span>
            </div>
            <p className="text-[10px] text-muted-foreground italic truncate">{d.paintHint}</p>
          </div>
        </div>
      ))}
    </div>
  );

  const PaletteTabs = (
    <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5 text-[10px] font-medium">
      {([
        { id: 'dominant' as PaletteView, label: 'Dominant' },
        { id: 'value' as PaletteView, label: 'Value' },
        { id: 'mix' as PaletteView, label: 'Paint Mix' },
      ]).map(t => (
        <button key={t.id} onClick={() => setPaletteView(t.id)}
          className={`px-2.5 py-1 rounded transition-colors ${
            paletteView === t.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}>{t.label}</button>
      ))}
    </div>
  );

  const ActivePaletteContent = paletteView === 'value' ? PaletteRows
    : paletteView === 'mix' ? MixRows : DominantRows;

  const DominantStrip = (
    <div className="flex w-full h-10 rounded-md overflow-hidden border border-border bg-secondary/40">
      {dominant.map(d => (
        <div key={d.key}
          style={{ flexBasis: `${Math.max(d.pct, 2)}%`, backgroundColor: d.hex }}
          title={`${d.label} • ${d.pct.toFixed(1)}% • ${d.hex}`}
        />
      ))}
    </div>
  );

  const maxImgH = fullscreen ? 'max-h-[88vh]' : 'max-h-full';
  const ProcessedImage = (
    <div className={`relative w-full h-full flex items-center justify-center ${fullscreen ? 'p-1' : 'p-3'}`}>
      {showCompare && processedUrl && compareMode === 'side' ? (
        <div className="flex gap-3 w-full h-full items-center justify-center">
          <div className="flex-1 h-full flex flex-col items-center justify-center min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Original</p>
            <img src={activeImage} alt="Original" className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
          </div>
          <div className="flex-1 h-full flex flex-col items-center justify-center min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Processed</p>
            <img src={processedUrl} alt="Processed" className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
          </div>
        </div>
      ) : showCompare && processedUrl && compareMode === 'slider' ? (
        <div className="relative inline-block max-w-full max-h-full select-none">
          <img src={activeImage} alt="Original" className={`block max-w-full ${maxImgH} object-contain rounded`} />
          <div className="absolute inset-0 overflow-hidden rounded" style={{ clipPath: `inset(0 0 0 ${compareSlider}%)` }}>
            <img src={processedUrl} alt="Processed" className={`block max-w-full ${maxImgH} object-contain rounded`} />
          </div>
          <div className="absolute top-0 bottom-0 w-px bg-primary/80 pointer-events-none" style={{ left: `${compareSlider}%` }} />
          <input type="range" min={0} max={100} value={compareSlider}
            onChange={(e) => setCompareSlider(Number(e.target.value))}
            className="absolute inset-x-4 bottom-3 accent-primary" />
        </div>
      ) : (
        processedUrl && <img src={processedUrl} alt="Value study"
          className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
      )}
      <button onClick={() => setFullscreen(v => !v)}
        className="absolute top-2 right-2 btn-tool bg-card/90 backdrop-blur-sm border border-border"
        title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
    </div>
  );

  // === Mobile layout ===
  if (isMobile) {
    return (
      <div className="relative flex-1 flex flex-col min-h-0 canvas-area">
        <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center">
          {mobileView === 'original' && <img src={activeImage} alt="Original" className="max-h-full max-w-full object-contain" />}
          {mobileView === 'processed' && processedUrl && <img src={processedUrl} alt="Processed" className="max-h-full max-w-full object-contain" />}
          {mobileView === 'palette' && (
            <div className="w-full h-full overflow-y-auto p-3 space-y-3">
              <div className="flex items-center justify-between">
                {PaletteTabs}
                <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                  dominantWarmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
                  : dominantWarmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-secondary text-muted-foreground'
                }`}>{dominantWarmth}</span>
              </div>
              {paletteView === 'value' ? DistributionStrip : DominantStrip}
              {ActivePaletteContent}
            </div>
          )}
        </div>

        {/* Top: distribution strip always visible (compact) when not on palette view */}
        {mobileView !== 'palette' && groups.length > 0 && (
          <div className="px-3 py-2 border-t border-border toolbar-surface">
            {DistributionStrip}
          </div>
        )}

        {/* Mobile swipe-style tab bar */}
        <div className="flex border-t border-border toolbar-surface shrink-0">
          {(['original', 'processed', 'palette'] as const).map(v => (
            <button key={v} onClick={() => setMobileView(v)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                mobileView === v ? 'text-primary border-t-2 border-primary -mt-px' : 'text-muted-foreground'
              }`}>{v}</button>
          ))}
          <button onClick={() => setShowMobileControls(true)}
            className="px-4 py-2.5 text-muted-foreground border-l border-border" title="Controls">
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>

        {showMobileControls && (
          <div className={`absolute inset-x-0 bottom-0 z-30 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl transition-opacity ${
            activeSlider ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sticky top-0 bg-card">
              <p className="text-sm font-semibold">Value controls</p>
              <button onClick={() => setShowMobileControls(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">{ControlsBlock}</div>
          </div>
        )}

        {MobileSliderFocusBar}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  // === Desktop layout ===
  return (
    <div className="flex-1 flex min-h-0">
      {/* Left controls */}
      <aside className="w-60 panel-surface border-r border-border p-4 overflow-y-auto shrink-0">
        <h2 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">Value Studio</h2>
        {ControlsBlock}
      </aside>

      {/* Center: image dominates ~70% */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-[7] canvas-area flex items-center justify-center min-h-0 overflow-hidden">
          {ProcessedImage}
        </div>

        {/* Compact palette analysis — fixed footprint, internal scroll */}
        <div className="flex-[3] min-h-[180px] max-h-[34vh] border-t border-border panel-surface px-3 py-2 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {PaletteTabs}
              <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                dominantWarmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
                : dominantWarmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
                : 'bg-secondary text-muted-foreground'
              }`}>{dominantWarmth}</span>
            </div>
            {isolatedIdx !== null && (
              <button onClick={() => setIsolatedIdx(null)}
                className="text-[10px] text-primary hover:underline">Clear isolation</button>
            )}
          </div>
          <div className="shrink-0">{paletteView === 'value' ? DistributionStrip : DominantStrip}</div>
          <div className="flex-1 overflow-y-auto">{ActivePaletteContent}</div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
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