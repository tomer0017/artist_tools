import type { OnboardingConfig, ToolId } from './onboardingTypes';

// ─── Tool onboarding registry ─────────────────────────────────────────────────
// The single source of truth for every tour. Adding onboarding to a future tool
// means appending one entry here — the preview + spotlight engine is shared and
// needs no new code. Copy is deliberately short (Apple-onboarding, not docs):
// every step answers one thing in at most two lines.

export const ONBOARDING: Partial<Record<ToolId, OnboardingConfig>> = {
  measure: {
    id: 'measure',
    title: 'Proportion Measure',
    tagline: 'Measure real proportions and angles on your reference so your drawing stays accurate.',
    preview: [
      { variant: 'original', label: 'Reference' },
      { variant: 'measure', label: 'Measured' },
    ],
    steps: [
      {
        target: 'measure-canvas',
        title: 'Set a reference length',
        body: 'Draw a calibration line, then enter its real size to scale every measurement.',
      },
      {
        target: 'measure-tools',
        title: 'Measure & compare',
        body: 'Add lines to read lengths, angles and ratios across the subject.',
      },
      {
        title: 'Collect colors too',
        body: 'Use the eyedropper to sample colors and send them straight to the Color tab.',
      },
    ],
  },

  value: {
    id: 'value',
    title: 'Value Study',
    tagline: 'Turn any reference into color groups, value maps and a clean drawing guide.',
    preview: [
      { variant: 'original', label: 'Original' },
      { variant: 'color', label: 'Color' },
      { variant: 'values', label: 'Values' },
      { variant: 'sketch', label: 'Sketch' },
    ],
    steps: [
      {
        target: 'value-modes',
        title: 'Pick a study',
        body: 'Switch Color, Values or Sketch — each answers a different question.',
      },
      {
        target: 'value-levels',
        title: 'Choose value groups',
        body: 'Fewer groups simplify the masses; more separate subtle transitions.',
      },
      {
        target: 'value-inline',
        title: 'Tune the read',
        body: 'Adjust contrast and brightness — or sketch detail — right under the image.',
      },
      {
        target: 'value-save',
        title: 'Save your study',
        body: 'Export the processed image, the palette or a full study sheet.',
      },
    ],
  },

  color: {
    id: 'color',
    title: 'Color Studio',
    tagline: 'Find, mix and harmonize colors — from the wheel to ready-made paint recipes.',
    preview: [
      { variant: 'wheel', label: 'Pick' },
      { variant: 'color', label: 'Harmonies' },
      { variant: 'original', label: 'From a photo' },
    ],
    steps: [
      {
        target: 'color-wheel',
        title: 'Pick a color',
        body: 'Drag the ring for hue and the square for shade.',
      },
      {
        target: 'color-harmony',
        title: 'Build harmonies',
        body: 'Tap any swatch to explore complementary, analogous and triadic sets.',
      },
      {
        target: 'color-tabs',
        title: 'Recipes & skin tones',
        body: 'Switch tabs for step-by-step mixing recipes and skin-tone mixes.',
      },
      {
        target: 'color-pick',
        title: 'Sample from a photo',
        body: 'Load a reference and pick colors straight off the image.',
      },
    ],
  },

  grid: {
    id: 'grid',
    title: 'Grid Guide',
    tagline: 'Lay an accurate grid over your canvas and reference to transfer proportions by eye.',
    preview: [
      { variant: 'original', label: 'Reference' },
      { variant: 'grid', label: 'Gridded' },
    ],
    steps: [
      {
        target: 'grid-size',
        title: 'Set your canvas',
        body: 'Enter your real canvas size or pick a ratio so the grid matches your surface.',
      },
      {
        target: 'grid-divisions',
        title: 'Choose divisions',
        body: 'More rows and columns give finer, more precise cells.',
      },
      {
        target: 'grid-canvas',
        title: 'Fit your image',
        body: 'Drag, pinch or use Fit / Fill to place the reference in the frame.',
      },
      {
        target: 'grid-export',
        title: 'Save the grid',
        body: 'Export a printable grid to draw the same lines on your canvas.',
      },
    ],
  },

  compare: {
    id: 'compare',
    title: 'Compare Art',
    tagline: 'Overlay your painting on the reference to instantly see what to fix.',
    preview: [
      { variant: 'original', label: 'Reference' },
      { variant: 'compare', label: 'Overlay' },
    ],
    steps: [
      {
        title: 'Add two images',
        body: 'Load your reference and a photo of your painting to compare them.',
      },
      {
        target: 'compare-canvas',
        title: 'Align them',
        body: 'Drag, pinch or use Smart Align so both images sit exactly on top of each other.',
      },
      {
        target: 'compare-bar',
        title: 'Try the modes',
        body: 'Overlay, Blink, Split and Difference each reveal errors differently.',
      },
      {
        target: 'compare-update',
        title: 'Update as you paint',
        body: 'Snap a new photo of your painting anytime to re-check your progress.',
      },
    ],
  },
};
