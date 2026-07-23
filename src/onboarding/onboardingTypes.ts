import type { TabId } from '@/types/project';

// The onboarding system is keyed by tool. A tool is just a workspace tab, so the
// two id spaces are intentionally the same — registering onboarding for a new
// tool means adding one entry to ONBOARDING, nothing more.
export type ToolId = TabId;

// Built-in, code-driven demo visuals used by the "show the outcome" preview.
// They require no binary assets, so the framework ships weightless and every
// frame stays crisp at any size. A config can still point a frame at a real
// image via `src` when curated before/after art becomes available.
export type PreviewVariant =
  | 'original'
  | 'color'
  | 'values'
  | 'sketch'
  | 'grid'
  | 'measure'
  | 'wheel'
  | 'compare';

// A single stage in the transformation progression a tool can produce
// (e.g. Original → Color → Values → Sketch). Show results before controls.
export interface PreviewFrame {
  // Rendered demo visual. Ignored when `src` is provided.
  variant?: PreviewVariant;
  // Optional image URL — swap in a curated asset later without touching code.
  src?: string;
  // Short label shown under the frame (e.g. "Values").
  label: string;
}

// One guided-tour step. `target` names an element marked with
// data-onboarding="<target>"; omit it for a calm, centered explainer step.
export interface TourStep {
  target?: string;
  title: string;
  body: string;
}

// Everything a tool needs to declare. The rendering engine is shared; a tool
// only supplies this configuration.
export interface OnboardingConfig {
  id: ToolId;
  // Tool name, shown in the preview header.
  title: string;
  // One-sentence value statement — what problem the tool solves.
  tagline: string;
  // The visual "what it produces" progression (kept short, 2–4 frames).
  preview: PreviewFrame[];
  // The guided tour (kept to 3–5 steps).
  steps: TourStep[];
}
