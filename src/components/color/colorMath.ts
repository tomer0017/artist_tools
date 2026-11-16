// Colour arithmetic of Color & Mixing: HSV ⇄ RGB ⇄ HEX and the hue and
// temperature shifts the harmonies are built from. Moved unchanged from
// ColorTab.tsx so the wheel, the harmony cards and the tests share one
// implementation; the results must stay exactly what they were
// (colorMath.test.ts compares them with a frozen copy of the original).

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100; v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return [Math.round(h), Math.round(s), Math.round(v)];
}

export function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHsv(r, g, b);
}

export function isValidHex(hex: string): boolean { return /^#[0-9a-fA-F]{6}$/.test(hex); }

export function shiftHue(hex: string, deg: number): string {
  const [h, s, v] = hexToHsv(hex);
  return hsvToHex((h + deg + 360) % 360, s, v);
}

export function warmer(hex: string): string {
  // pull hue toward 40° (warm yellow-orange) and slightly boost saturation
  const [h, s, v] = hexToHsv(hex);
  const target = 40;
  const diff = ((target - h + 540) % 360) - 180;
  const newH = (h + diff * 0.35 + 360) % 360;
  return hsvToHex(newH, Math.min(100, s + 6), v);
}

export function cooler(hex: string): string {
  const [h, s, v] = hexToHsv(hex);
  const target = 220;
  const diff = ((target - h + 540) % 360) - 180;
  const newH = (h + diff * 0.35 + 360) % 360;
  return hsvToHex(newH, Math.min(100, s + 6), v);
}
