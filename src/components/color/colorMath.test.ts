import { describe, expect, it } from 'vitest';
import { cooler, hexToHsv, hsvToHex, isValidHex, warmer } from './colorMath';
import { HARMONY_IDS, harmoniesOf, hueOnWheel, inkOn } from './harmonies';

// The harmonies must stay exactly what the Harmonies tab showed before the
// wheel and the harmonies were joined. `original` below is a frozen copy of
// the colour code as it was in ColorTab.tsx at d0acabe (2026-11-16), with the
// way that tab combined it: the moved code is compared with it over thousands
// of colours.

const original = (() => {
  function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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
  function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
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
  function hsvToHex(h: number, s: number, v: number): string {
    const [r, g, b] = hsvToRgb(h, s, v);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  function hexToHsv(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return rgbToHsv(r, g, b);
  }
  function isValidHex(hex: string): boolean { return /^#[0-9a-fA-F]{6}$/.test(hex); }

  function shiftHue(hex: string, deg: number): string {
    const [h, s, v] = hexToHsv(hex);
    return hsvToHex((h + deg + 360) % 360, s, v);
  }
  function warmer(hex: string): string {
    // pull hue toward 40° (warm yellow-orange) and slightly boost saturation
    const [h, s, v] = hexToHsv(hex);
    const target = 40;
    const diff = ((target - h + 540) % 360) - 180;
    const newH = (h + diff * 0.35 + 360) % 360;
    return hsvToHex(newH, Math.min(100, s + 6), v);
  }
  function cooler(hex: string): string {
    const [h, s, v] = hexToHsv(hex);
    const target = 220;
    const diff = ((target - h + 540) % 360) - 180;
    const newH = (h + diff * 0.35 + 360) % 360;
    return hsvToHex(newH, Math.min(100, s + 6), v);
  }

  /** What each card of the Harmonies tab showed, in its order. */
  function harmonies(selectedHex: string) {
    return {
      complementary: [selectedHex, shiftHue(selectedHex, 180)],
      splitComplementary: [selectedHex, shiftHue(selectedHex, 150), shiftHue(selectedHex, 210)],
      analogous: [shiftHue(selectedHex, -30), selectedHex, shiftHue(selectedHex, 30)],
      triadic: [selectedHex, shiftHue(selectedHex, 120), shiftHue(selectedHex, 240)],
      warm: [selectedHex, warmer(selectedHex)],
      cool: [selectedHex, cooler(selectedHex)],
    };
  }
  return { hsvToHex, hexToHsv, isValidHex, harmonies };
})();

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Every 17th level of red, green and blue (4,096 colours), plus an HSV sweep (14,520). */
function sampleColors(): string[] {
  const out: string[] = [];
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) out.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
  for (let h = 0; h < 360; h += 3) for (let s = 0; s <= 100; s += 10) for (let v = 0; v <= 100; v += 10) out.push(original.hsvToHex(h, s, v));
  return out;
}

describe('colour arithmetic, moved out of ColorTab unchanged', () => {
  it('converts exactly as before', () => {
    for (let h = 0; h <= 360; h += 7) {
      for (let s = 0; s <= 100; s += 9) {
        for (let v = 0; v <= 100; v += 9) expect(hsvToHex(h, s, v)).toBe(original.hsvToHex(h, s, v));
      }
    }
    for (const hex of sampleColors()) expect(hexToHsv(hex)).toEqual(original.hexToHsv(hex));
  });

  it('accepts the same HEX codes', () => {
    for (const text of ['#D4827A', '#d4827a', '#000000', '#FFFFFF', 'D4827A', '#D4827', '#D4827AA', '#GG0000', ' #D4827A', '']) {
      expect(isValidHex(text), text).toBe(original.isValidHex(text));
    }
  });
});

describe('the six harmonies', () => {
  it('are the same six, in the same order, with the same tags', () => {
    const list = harmoniesOf('#D4827A');
    expect(list.map((h) => h.id)).toEqual([...HARMONY_IDS]);
    expect(list.map((h) => h.colors.map((c) => ('key' in c.tag ? c.tag.key : c.tag.value)))).toEqual([
      ['base', 'comp'],
      ['base', 'splitA', 'splitB'],
      ['−30°', 'base', '+30°'],
      ['base', 'triA', 'triB'],
      ['base', 'warmer'],
      ['base', 'cooler'],
    ]);
    // The base is the selected colour itself, exactly as typed.
    for (const h of list) expect(h.colors.filter((c) => c.base).map((c) => c.hex)).toEqual(['#D4827A']);
  });

  it('give every colour exactly as the Harmonies tab did, over 18,616 colours', () => {
    let checked = 0;
    for (const hex of sampleColors()) {
      const expected = original.harmonies(hex);
      for (const h of harmoniesOf(hex)) {
        expect(h.colors.map((c) => c.hex), `${h.id} of ${hex}`).toEqual(expected[h.id]);
        checked++;
      }
    }
    expect(checked).toBe(18_616 * 6);
  });

  it('for the default colour, #D4827A', () => {
    const colors = Object.fromEntries(harmoniesOf('#D4827A').map((h) => [h.id, h.colors.map((c) => c.hex)]));
    expect(colors).toEqual(EXPECTED_D4827A);
  });

  it('turn the hue by the classic angles, keeping saturation and brightness', () => {
    const angle = (from: string, to: string) => (((hexToHsv(to)[0] - hexToHsv(from)[0]) % 360) + 360) % 360;
    for (const hex of ['#D4827A', '#2A5FAA', '#4A8C2A', '#C42A80', '#F5C542']) {
      const [complementary, split, analogous, triadic] = harmoniesOf(hex);
      const near = (actual: number, expected: number) => expect(Math.min(Math.abs(actual - expected), 360 - Math.abs(actual - expected))).toBeLessThanOrEqual(1);
      near(angle(hex, complementary.colors[1].hex), 180);
      near(angle(hex, split.colors[1].hex), 150);
      near(angle(hex, split.colors[2].hex), 210);
      near(angle(hex, analogous.colors[0].hex), 330);
      near(angle(hex, analogous.colors[2].hex), 30);
      near(angle(hex, triadic.colors[1].hex), 120);
      near(angle(hex, triadic.colors[2].hex), 240);
      for (const c of [...complementary.colors, ...triadic.colors]) {
        expect(Math.abs(hexToHsv(c.hex)[1] - hexToHsv(hex)[1])).toBeLessThanOrEqual(1);
        expect(Math.abs(hexToHsv(c.hex)[2] - hexToHsv(hex)[2])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('warm toward 40° and cool toward 220°', () => {
    const towards = (hex: string, shifted: string, target: number) => {
      const gap = (h: number) => Math.min(Math.abs(h - target), 360 - Math.abs(h - target));
      return gap(hexToHsv(shifted)[0]) < gap(hexToHsv(hex)[0]);
    };
    for (const hex of ['#D4827A', '#2A5FAA', '#4A8C2A', '#C42A80']) {
      expect(towards(hex, warmer(hex), 40), hex).toBe(true);
      expect(towards(hex, cooler(hex), 220), hex).toBe(true);
    }
  });
});

describe('placing colours on the wheel', () => {
  it('puts a colour at its hue, and a grey nowhere', () => {
    expect(hueOnWheel('#ff0000')).toBe(0);
    expect(hueOnWheel('#00ff00')).toBe(120);
    expect(hueOnWheel('#0000ff')).toBe(240);
    expect(hueOnWheel('#808080')).toBeNull();
    expect(hueOnWheel('#000000')).toBeNull();
    // The complementary of the default colour sits opposite it.
    const [base, comp] = harmoniesOf('#D4827A')[0].colors;
    expect(Math.abs(hueOnWheel(comp.hex)! - hueOnWheel(base.hex)!)).toBe(180);
  });

  it('draws a check mark in whichever ink reads better on the swatch', () => {
    expect(inkOn('#ffffff')).toBe('#1a1a1a');
    expect(inkOn('#f5c542')).toBe('#1a1a1a');
    expect(inkOn('#000000')).toBe('#f5f0e8');
    expect(inkOn('#2a5faa')).toBe('#f5f0e8');
  });
});

const EXPECTED_D4827A = {
  complementary: ['#D4827A', '#7bccd4'],
  splitComplementary: ['#D4827A', '#7bd4af', '#7ba0d4'],
  analogous: ['#d47ba0', '#D4827A', '#d4af7b'],
  triadic: ['#D4827A', '#7bd482', '#827bd4'],
  warm: ['#D4827A', '#d48b6e'],
  // The cool version of this warm pink turns the short way round, past red, to a cool magenta.
  cool: ['#D4827A', '#d46ebc'],
};
