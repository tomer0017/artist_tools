import type { OnboardingSpec, ToolId } from './onboardingTypes';

// ─── Tool onboarding registry ─────────────────────────────────────────────────
// The single source of truth for every tour. Adding onboarding to a future tool
// means appending one entry here, and its words to the messages
// (toolsCommon.tours.<id>) — the preview + spotlight engine is shared and
// needs no new code. Copy is deliberately short (Apple-onboarding, not docs):
// every step answers one thing in at most two lines.

// Tutorials never open on their own: each tool screen is designed to explain
// itself (goal-first title, a one-line task, one obvious first action), so an
// overlay should not stand between a first-time artist and the work. Every
// tutorial stays one tap away behind the tool's Help (?) button. Flip this to
// restore the previous show-once-per-tool behaviour.
export const AUTO_START_TUTORIALS = false;

export const ONBOARDING: Partial<Record<ToolId, OnboardingSpec>> = {
  // NOTE: Measure intentionally has NO entry here. It uses a dedicated,
  // workflow-driven onboarding (a single illustrated intro + an on-canvas
  // helper + a success card) instead of the generic preview + spotlight tour —
  // see src/components/measure/onboarding/. Its Help replay is handled by
  // MeasureHelpButton, not the generic HelpButton.
  value: {
    id: 'value',
    preview: [{ variant: 'original' }, { variant: 'color' }, { variant: 'values' }, { variant: 'sketch' }],
    steps: [
      { key: 'modes', target: 'value-modes' },
      { key: 'levels', target: 'value-levels' },
      { key: 'inline', target: 'value-inline' },
      { key: 'save', target: 'value-save' },
    ],
  },

  color: {
    id: 'color',
    preview: [{ variant: 'wheel' }, { variant: 'color' }, { variant: 'original' }],
    steps: [
      { key: 'wheel', target: 'color-wheel' },
      { key: 'harmonies', target: 'color-tabs' },
      { key: 'recipes', target: 'color-tabs' },
      { key: 'pick', target: 'color-pick' },
    ],
  },

  grid: {
    id: 'grid',
    preview: [{ variant: 'original' }, { variant: 'grid' }],
    steps: [
      { key: 'size', target: 'grid-size' },
      { key: 'divisions', target: 'grid-divisions' },
      { key: 'canvas', target: 'grid-canvas' },
      { key: 'export', target: 'grid-export' },
    ],
  },

  // NOTE: Compare Art, like Measure, intentionally has NO entry here. It uses a
  // dedicated, workflow-driven visual onboarding (an animated intro demonstrating
  // both comparison workflows + the Load → Align → Compare → Grid → GIF flow) in
  // src/features/compare-art/onboarding/. Its Help replay is handled by
  // CompareHelpButton, not the generic HelpButton.
};
