// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_PROCESS_DIM, preBlur, processingSize, studyValues, type DominantSwatch, type Focus, type Mode, type ValueGroup } from './posterize';

// The Values algorithm moved out of Study & Simplify unchanged (Learn plan M3,
// decision A12). `before()` below is the code as it was in
// src/components/value/ValueTab.tsx at d261013, copied line for line: the
// helpers, and processImage's work from reading the pixels back to building
// the groups, run against stand-ins for the canvas and React state it used.
// The module must give the same pixels, value groups and dominant colours,
// for every mode, number of values, focus, contrast, brightness and isolation.

type Options = { mode: Mode; levels: number; focus: Focus; contrast: number; brightness: number; isolatedIdx: number | null };

function before(pixels: Uint8ClampedArray, w: number, h: number, options: Options) {
  type Mode = 'grayscale' | 'color' | 'painter' | 'sketch';
  type Focus = 'none' | 'shadow' | 'highlight' | 'squint';
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

  const { mode, levels, focus, contrast, brightness, isolatedIdx } = options;
  // Stand-ins for what processImage used around the algorithm.
  const ctx = { getImageData: (_x: number, _y: number, _w: number, _h: number) => ({ data: pixels }), putImageData: (_d: unknown, _x: number, _y: number) => {} };
  const canvas = { toDataURL: (_type: string, _quality: number) => '' };
  let dominant: DominantSwatch[] = [];
  let groups: ValueGroup[] = [];
  let rendered = false;
  const setDominant = (d: DominantSwatch[]) => { dominant = d; };
  const setGroups = (g: ValueGroup[]) => { groups = g; };
  const setProcessedUrl = (_url: string) => { rendered = true; };

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
        // === Sketch mode ===
        // The drawing (Clean Outline or Pencil Study) is computed off the main
        // thread by the sketch worker (useSketchDrawing). This pass only builds
        // the value and dominant palettes below, which the palette and study
        // sheet exports still use.
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
  return { dominant, groups, rendered };
}

/** A small deterministic random sequence (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 48;
const H = 36;
function picture(fill: (x: number, y: number, rnd: () => number) => [number, number, number]): Uint8ClampedArray {
  const rnd = random(W * 7 + H);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y, rnd);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

// Noise, gradients, and patches of the colours the palette code treats specially (skin, olive, magenta, neutrals).
const PICTURES: [string, Uint8ClampedArray][] = [
  ['noise', picture((_x, _y, rnd) => [rnd() * 255, rnd() * 255, rnd() * 255])],
  ['gradients', picture((x, y) => [(x / (W - 1)) * 255, (y / (H - 1)) * 255, ((x + y) / (W + H - 2)) * 255])],
  ['patches', picture((x, y) => [[226, 172, 140], [120, 128, 60], [200, 40, 160], [30, 30, 32], [245, 245, 240], [40, 90, 200], [180, 60, 40], [90, 160, 80]][Math.floor(x / 12) + 4 * Math.floor(y / 18)] as [number, number, number])],
  ['skin and shadows', picture((x, y, rnd) => [150 + 90 * Math.sin(x / 7) * Math.cos(y / 5) + rnd() * 10, 110 + 60 * Math.sin(x / 7) + rnd() * 10, 90 + 40 * Math.cos(y / 5) + rnd() * 10])],
  ['near black and white', picture((x, _y, rnd) => (x % 2 ? [252 + rnd() * 3, 252, 250] : [2 + rnd() * 4, 3, 4]))],
];

const MODES: Mode[] = ['grayscale', 'color', 'painter', 'sketch'];
const FOCUS: Focus[] = ['none', 'shadow', 'highlight', 'squint'];
const TONE: [number, number][] = [[100, 100], [140, 70], [60, 130]];

describe('the Values algorithm, moved out of Study & Simplify', () => {
  for (const [name, source] of PICTURES) {
    it(`gives exactly the same study as before: ${name}, every mode, 2 to 9 values, focus, contrast, brightness, isolation`, () => {
      let runs = 0;
      for (const mode of MODES)
        for (const levels of [2, 3, 5, 9])
          for (const focus of FOCUS)
            for (const [contrast, brightness] of TONE)
              for (const isolatedIdx of [null, 1]) {
                const options = { mode, levels, focus, contrast, brightness, isolatedIdx };
                const old = new Uint8ClampedArray(source);
                const moved = new Uint8ClampedArray(source);
                const expected = before(old, W, H, options);
                const actual = studyValues(moved, W, H, options);
                expect(Buffer.from(moved).equals(Buffer.from(old)), `${mode} ${levels} ${focus} ${contrast}/${brightness} ${isolatedIdx}`).toBe(true);
                expect(actual.dominant).toStrictEqual(expected.dominant);
                expect(actual.groups).toStrictEqual(expected.groups);
                expect(actual.rendered).toBe(expected.rendered);
                runs++;
              }
      expect(runs).toBe(384);
    });
  }

  it('works at the same size, after the same blur, as Study did', () => {
    expect(MAX_PROCESS_DIM).toBe(900);
    for (const [nw, nh] of [[4032, 3024], [300, 400], [900, 900], [901, 2], [1, 5000]]) {
      // As processImage computed them.
      const scale = Math.min(1, 900 / Math.max(nw, nh));
      expect(processingSize(nw, nh)).toEqual({ w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) });
    }
    for (const mode of MODES) {
      for (const focus of FOCUS) {
        expect(preBlur(mode, focus)).toBe(focus === 'squint' ? 5 : mode === 'painter' ? 2.5 : mode === 'sketch' ? 0 : mode === 'color' ? 1.2 : 0);
      }
    }
  });

  it('a grayscale study holds only its gray values: 3 and 5 values', () => {
    for (const levels of [3, 5]) {
      const data = new Uint8ClampedArray(PICTURES[3][1]);
      studyValues(data, W, H, { mode: 'grayscale', levels, focus: 'none', contrast: 100, brightness: 100, isolatedIdx: null });
      const grays = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        expect(data[i]).toBe(data[i + 1]);
        expect(data[i]).toBe(data[i + 2]);
        grays.add(data[i]);
      }
      const allowed = Array.from({ length: levels }, (_, bin) => Math.round((bin + 0.5) * (255 / levels)));
      for (const g of grays) expect(allowed.some((a) => Math.abs(a - g) <= 1)).toBe(true);
    }
  });
});
