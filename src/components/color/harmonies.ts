import { cooler, hexToHsv, shiftHue, warmer } from './colorMath';

// The six harmonies of Color & Mixing, in the order the tool has always shown
// them, built from the selected colour with exactly the calls the Harmonies
// tab made (colorMath.ts). Names and tags are messages (colorTool.harmonies,
// colorTool.tags); the analogous offsets are values, shown as written.

export type HarmonyId = 'complementary' | 'splitComplementary' | 'analogous' | 'triadic' | 'warm' | 'cool';
export type HarmonyTag = 'base' | 'comp' | 'splitA' | 'splitB' | 'triA' | 'triB' | 'warmer' | 'cooler';

export interface HarmonyColor {
  hex: string;
  /** A message key (colorTool.tags), or a value such as −30° that stays left to right in every language. */
  tag: { key: HarmonyTag } | { value: string };
  /** The selected colour itself: on the wheel it is the hue handle, not a dot. */
  base: boolean;
}

export interface Harmony {
  id: HarmonyId;
  colors: HarmonyColor[];
}

export const HARMONY_IDS: readonly HarmonyId[] = ['complementary', 'splitComplementary', 'analogous', 'triadic', 'warm', 'cool'];

const base = (hex: string): HarmonyColor => ({ hex, tag: { key: 'base' }, base: true });
const other = (hex: string, key: HarmonyTag): HarmonyColor => ({ hex, tag: { key }, base: false });
const offset = (hex: string, value: string): HarmonyColor => ({ hex, tag: { value }, base: false });

/** Every harmony of the selected colour. */
export function harmoniesOf(selectedHex: string): Harmony[] {
  return [
    { id: 'complementary', colors: [base(selectedHex), other(shiftHue(selectedHex, 180), 'comp')] },
    {
      id: 'splitComplementary',
      colors: [base(selectedHex), other(shiftHue(selectedHex, 150), 'splitA'), other(shiftHue(selectedHex, 210), 'splitB')],
    },
    { id: 'analogous', colors: [offset(shiftHue(selectedHex, -30), '−30°'), base(selectedHex), offset(shiftHue(selectedHex, 30), '+30°')] },
    {
      id: 'triadic',
      colors: [base(selectedHex), other(shiftHue(selectedHex, 120), 'triA'), other(shiftHue(selectedHex, 240), 'triB')],
    },
    { id: 'warm', colors: [base(selectedHex), other(warmer(selectedHex), 'warmer')] },
    { id: 'cool', colors: [base(selectedHex), other(cooler(selectedHex), 'cooler')] },
  ];
}

/** Where a colour sits on the hue ring, in degrees; null for a grey, which has no hue. */
export function hueOnWheel(hex: string): number | null {
  const [h, s] = hexToHsv(hex);
  return s === 0 ? null : h;
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const DARK_INK = '#1a1a1a';
const LIGHT_INK = '#f5f0e8';
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The dark or the light ink, whichever contrasts more with the colour (a check mark drawn on a swatch). */
export function inkOn(hex: string): typeof DARK_INK | typeof LIGHT_INK {
  const l = luminance(hex);
  return contrast(l, luminance(DARK_INK)) >= contrast(l, luminance(LIGHT_INK)) ? DARK_INK : LIGHT_INK;
}
