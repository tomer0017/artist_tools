import type { ToolId } from './account';

// ─── Features and plans ───────────────────────────────────────────────────────
// The catalogue of capabilities and the default of which plan includes which —
// shared by the server, which decides (src/server/entitlements.ts), and the
// studio, which follows a copy of that decision. What applies is the published
// plan catalog (src/server/config/catalog.ts), which admins edit; the defaults
// here are its version 1.
//
// By default Free keeps all five tools and every existing save; Pro adds the
// two heavier GIF options. Admins get every feature, whatever their plan.
// Features added later (the grid PDF, worksheets, Learn) are in no default
// plan: they reach Free or Pro only when an admin publishes them (dark
// launch, ADR-0006).

export const FEATURES = [
  'tool.measure',
  'tool.study',
  'tool.color',
  'tool.grid',
  'tool.compare',
  'export.image',
  'export.gif',
  'export.gif_large',
  'export.gif_difference',
  // Since M2 (2026-11): Create a Grid's A4 PDF (the reference with its grid, and the blank grid).
  'export.pdf',
  // Since M3 (2026-11): Prepare Worksheets, aligned practice sheets (PNG) from one photo.
  'export.worksheets',
  // Since M4 (2026-11): the Learn modules (ADR-0017). Each opens its items as
  // the catalog's Learn access rules say; on or off per plan, never counted.
  'learn.curriculum',
  'learn.color',
  'learn.challenges',
] as const;
export type FeatureId = (typeof FEATURES)[number];

export const PLAN_IDS = ['free', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PLAN_NAMES: Record<PlanId, string> = { free: 'Free', pro: 'Pro' };

/** Capabilities that only Pro (and admins) include. */
export const PRO_FEATURES: readonly FeatureId[] = ['export.gif_large', 'export.gif_difference'];

/** Capabilities in no plan until an admin publishes a catalog that includes them (admins have them already). */
export const UNPUBLISHED_FEATURES: readonly FeatureId[] = ['export.pdf', 'export.worksheets', 'learn.curriculum', 'learn.color', 'learn.challenges'];

export const PLAN_FEATURES: Record<PlanId, FeatureId[]> = {
  free: FEATURES.filter((feature) => !PRO_FEATURES.includes(feature) && !UNPUBLISHED_FEATURES.includes(feature)),
  pro: FEATURES.filter((feature) => !UNPUBLISHED_FEATURES.includes(feature)),
};

/**
 * The plan comparison as people read it (profile page, documentation). A row
 * marked `whenOffered` appears only once some plan (or the account) has it,
 * so nobody is shown a capability no plan includes.
 */
export const FEATURE_MATRIX: {
  id: 'tools' | 'images' | 'gifs' | 'large' | 'difference' | 'pdf' | 'worksheets' | 'learnCurriculum' | 'learnColor' | 'learnChallenges';
  label: string;
  detail: string;
  features: FeatureId[];
  whenOffered?: boolean;
}[] = [
  {
    id: 'tools',
    label: 'All five tools',
    detail: 'Measure & Plan, Study & Simplify, Color & Mixing, Create a Grid, Compare & Correct',
    features: ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare'],
  },
  { id: 'images', label: 'Save images', detail: 'Grids, studies and comparisons as PNG', features: ['export.image'] },
  { id: 'gifs', label: 'Comparison GIFs', detail: 'Opacity pulse and blink, small and medium sizes', features: ['export.gif'] },
  { id: 'large', label: 'Large GIFs', detail: 'Up to 800 px, for sharing and printing', features: ['export.gif_large'] },
  { id: 'difference', label: 'Compare + Difference GIFs', detail: 'Animations that highlight what differs', features: ['export.gif_difference'] },
  { id: 'pdf', label: 'Print-ready PDFs', detail: 'A4: the reference with its grid and a matching blank grid, to scale', features: ['export.pdf'], whenOffered: true },
  { id: 'worksheets', label: 'Worksheets', detail: 'Practice sheets from your photo: the original, an outline, the grid and the values, aligned', features: ['export.worksheets'], whenOffered: true },
  // Learn's modules (ADR-0018): shown once a published plan offers them, like the exports above.
  { id: 'learnCurriculum', label: 'Drawing course', detail: 'Step-by-step exercises in drawing from observation, with pencil and paper', features: ['learn.curriculum'], whenOffered: true },
  { id: 'learnColor', label: 'Color course', detail: 'Exercises in seeing and mixing color, after the pencil basics', features: ['learn.color'], whenOffered: true },
  { id: 'learnChallenges', label: 'Drawing challenges', detail: 'Subjects to draw, from quick sketches to longer studies', features: ['learn.challenges'], whenOffered: true },
];

/** Short names for usage counts and admin screens. */
export const FEATURE_LABELS: Record<FeatureId, string> = {
  'tool.measure': 'Measure & Plan',
  'tool.study': 'Study & Simplify',
  'tool.color': 'Color & Mixing',
  'tool.grid': 'Create a Grid',
  'tool.compare': 'Compare & Correct',
  'export.image': 'Saved images',
  'export.gif': 'GIFs',
  'export.gif_large': 'Large GIFs',
  'export.gif_difference': 'Compare + Difference GIFs',
  'export.pdf': 'Grid PDFs (A4)',
  'export.worksheets': 'Worksheets',
  'learn.curriculum': 'Drawing curriculum',
  'learn.color': 'Color module',
  'learn.challenges': 'Challenges',
};

/** The feature each tool needs (the studio's tool ids → catalog features). */
export const TOOL_FEATURES: Record<ToolId, ToolFeatureId> = {
  measure: 'tool.measure',
  value: 'tool.study',
  color: 'tool.color',
  grid: 'tool.grid',
  compare: 'tool.compare',
};

/** The tools' features: a tool is on or off per plan (it has no quota). */
export const TOOL_FEATURE_IDS = ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare'] as const satisfies readonly FeatureId[];
export type ToolFeatureId = (typeof TOOL_FEATURE_IDS)[number];

/** Everything that saves or exports something; each use is authorized (and counted) by the server. */
export const EXPORT_FEATURE_IDS = ['export.image', 'export.gif', 'export.gif_large', 'export.gif_difference', 'export.pdf', 'export.worksheets'] as const satisfies readonly FeatureId[];
export type ExportFeatureId = (typeof EXPORT_FEATURE_IDS)[number];

export const isToolFeature = (feature: FeatureId): feature is ToolFeatureId => (TOOL_FEATURE_IDS as readonly FeatureId[]).includes(feature);

/** The Learn modules (ADR-0017): on or off per plan, like tools; which items they open is the catalog's Learn access. */
export const LEARN_FEATURE_IDS = ['learn.curriculum', 'learn.color', 'learn.challenges'] as const satisfies readonly FeatureId[];
export type LearnFeatureId = (typeof LEARN_FEATURE_IDS)[number];

export const isLearnFeature = (feature: FeatureId): feature is LearnFeatureId => (LEARN_FEATURE_IDS as readonly FeatureId[]).includes(feature);

/** Whether a feature can have a quota: only what is saved or exported, which the server counts. Tools and Learn modules are on or off. */
export const hasQuota = (feature: FeatureId): feature is ExportFeatureId => (EXPORT_FEATURE_IDS as readonly FeatureId[]).includes(feature);

/** What each plan includes as published (the `plans` collection); empty for a plan that is switched off. */
export type PlanOffer = Record<PlanId, FeatureId[]>;

/** The tools in the order people meet them (Home, plan comparisons). */
const TOOL_ORDER: ToolId[] = ['measure', 'value', 'color', 'grid', 'compare'];

export type FeatureRow =
  | { kind: 'group'; id: (typeof FEATURE_MATRIX)[number]['id']; features: FeatureId[] }
  | { kind: 'tool'; id: ToolId; features: FeatureId[] };

/**
 * The rows people read (the account page, plan comparisons) for these feature
 * sets: one "All five tools" row while every set has all five tools or none,
 * otherwise one row per tool, so a tool that one plan lacks is never shown as
 * included (or all five as missing).
 */
export function featureRows(sets: readonly (readonly FeatureId[])[]): FeatureRow[] {
  const tools = TOOL_ORDER.map((tool) => TOOL_FEATURES[tool]);
  const together = sets.every((set) => tools.every((f) => set.includes(f)) || tools.every((f) => !set.includes(f)));
  return FEATURE_MATRIX.filter((row) => !row.whenOffered || sets.some((set) => row.features.some((f) => set.includes(f)))).flatMap((row): FeatureRow[] =>
    row.id === 'tools' && !together
      ? TOOL_ORDER.map((tool) => ({ kind: 'tool', id: tool, features: [TOOL_FEATURES[tool]] }))
      : [{ kind: 'group', id: row.id, features: row.features }],
  );
}

/** Whether a set of features has every one of the five tools. */
export const hasAllTools = (features: readonly FeatureId[]): boolean => TOOL_FEATURE_IDS.every((f) => features.includes(f));

/**
 * Whether the published plans split as the default texts describe them: Free
 * has all five tools, and Pro adds exactly the large and Compare + Difference
 * GIFs. Otherwise pages use wording that holds for any split and point to the
 * comparison, which is built from the published plans.
 */
export function isDefaultSplit(offer: PlanOffer): boolean {
  const added = offer.pro.filter((f) => !offer.free.includes(f));
  return hasAllTools(offer.free) && added.length === PRO_FEATURES.length && PRO_FEATURES.every((f) => added.includes(f));
}

/** Better of two plans (Pro outranks Free). */
export const betterPlan = (a: PlanId, b: PlanId | null): PlanId => (a === 'pro' || b === 'pro' ? 'pro' : 'free');

export const isPlanId = (value: unknown): value is PlanId => (PLAN_IDS as readonly unknown[]).includes(value);
