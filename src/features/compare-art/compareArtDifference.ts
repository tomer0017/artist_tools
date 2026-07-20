// Compare Art — difference analysis (pure, testable).
//
// Input: two equally-sized RGBA buffers already rendered in the SAME scene
// geometry (artwork vs aligned reference). Output: an RGBA overlay that is
// quiet where the images match and coloured where they diverge, plus summary
// stats. The purpose is to guide a painter's eye, not to grade photographs — so
// the mapping favours legibility over raw precision.

import { DIFF_COLORS, DifferenceMetric, Sensitivity, SENSITIVITY_PARAMS } from './compareArtTypes';
import { colorDelta, rgbToOklab } from './compareArtColor';

export interface Buffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface DifferenceStats {
  /** Fraction of compared pixels above threshold (0..1). */
  mismatchRatio: number;
  /** Mean perceptual delta over compared pixels. */
  meanDelta: number;
  /** Fraction of mismatched pixels where the artwork is lighter than reference. */
  lighterRatio: number;
  darkerRatio: number;
  warmerRatio: number;
  coolerRatio: number;
}

export interface DifferenceResult {
  overlay: Uint8ClampedArray; // RGBA, same size as inputs
  stats: DifferenceStats;
}

function blend(
  out: Uint8ClampedArray,
  i: number,
  color: readonly [number, number, number],
  alpha: number,
) {
  out[i] = color[0];
  out[i + 1] = color[1];
  out[i + 2] = color[2];
  out[i + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
}

/**
 * Compute a difference overlay for `metric` at the given `sensitivity`.
 * A pixel whose alpha is 0 in either input (outside the drawn image) is treated
 * as "no data" and left transparent so out-of-bounds regions never register as
 * huge differences.
 */
export function computeDifference(
  artwork: Buffer,
  reference: Buffer,
  metric: DifferenceMetric,
  sensitivity: Sensitivity,
  monochrome: boolean,
): DifferenceResult {
  const n = Math.min(artwork.data.length, reference.data.length);
  const px = Math.min(artwork.width * artwork.height, reference.width * reference.height);
  const overlay = new Uint8ClampedArray(px * 4);
  const { threshold, gain } = SENSITIVITY_PARAMS[sensitivity];

  let compared = 0;
  let mismatched = 0;
  let sumDelta = 0;
  let lighter = 0;
  let darker = 0;
  let warmer = 0;
  let cooler = 0;

  for (let i = 0; i < n; i += 4) {
    const aAlpha = artwork.data[i + 3];
    const bAlpha = reference.data[i + 3];
    if (aAlpha < 8 || bAlpha < 8) {
      overlay[i + 3] = 0; // no data here
      continue;
    }
    compared++;

    const ar = artwork.data[i];
    const ag = artwork.data[i + 1];
    const ab = artwork.data[i + 2];
    const br = reference.data[i];
    const bg = reference.data[i + 1];
    const bb = reference.data[i + 2];

    const artLab = rgbToOklab(ar, ag, ab);
    const refLab = rgbToOklab(br, bg, bb);
    const d = colorDelta(artLab, refLab);

    // The magnitude that drives visibility depends on the chosen metric.
    const magnitude = metric === 'value' ? Math.abs(d.dL) : d.deltaE;
    sumDelta += magnitude;

    if (magnitude <= threshold) {
      overlay[i + 3] = 0; // quiet where it matches
      continue;
    }
    mismatched++;
    const intensity = Math.min(1, (magnitude - threshold) * gain);

    if (d.dL > 0) lighter++; else darker++;
    if (d.dWarm > 0) warmer++; else cooler++;

    if (monochrome) {
      // Neutral highlight — magnitude only, no hue meaning.
      const v = Math.round(intensity * 255);
      overlay[i] = v;
      overlay[i + 1] = v;
      overlay[i + 2] = v;
      overlay[i + 3] = Math.round(intensity * 255);
      continue;
    }

    if (metric === 'value') {
      // Amber where the artwork is too light, blue where too dark.
      blend(overlay, i, d.dL > 0 ? DIFF_COLORS.lighter : DIFF_COLORS.darker, intensity);
    } else {
      // Colour mode: red = artwork too warm, cyan = too cool. Fall back to
      // lightness colours when the difference is mostly a value shift.
      const warmCoolMag = Math.abs(d.dWarm);
      const valueMag = Math.abs(d.dL);
      if (warmCoolMag >= valueMag) {
        blend(overlay, i, d.dWarm > 0 ? DIFF_COLORS.warm : DIFF_COLORS.cool, intensity);
      } else {
        blend(overlay, i, d.dL > 0 ? DIFF_COLORS.lighter : DIFF_COLORS.darker, intensity);
      }
    }
  }

  const denom = mismatched || 1;
  return {
    overlay,
    stats: {
      mismatchRatio: compared ? mismatched / compared : 0,
      meanDelta: compared ? sumDelta / compared : 0,
      lighterRatio: lighter / denom,
      darkerRatio: darker / denom,
      warmerRatio: warmer / denom,
      coolerRatio: cooler / denom,
    },
  };
}
