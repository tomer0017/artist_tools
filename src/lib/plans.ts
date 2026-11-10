// ─── Features and plans ───────────────────────────────────────────────────────
// The catalogue of capabilities and which plan includes which — shared by the
// server, which decides (src/server/entitlements.ts), and the studio, which
// only shows locks from a copy of that decision. Plans are defined here; the
// database migration writes these definitions to the `plans` collection.
//
// Free keeps all five tools and every existing save; Pro adds the two heavier
// GIF options. Admins get every feature, whatever their plan.

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
] as const;
export type FeatureId = (typeof FEATURES)[number];

export const PLAN_IDS = ['free', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PLAN_NAMES: Record<PlanId, string> = { free: 'Free', pro: 'Pro' };

/** Capabilities that only Pro (and admins) include. */
export const PRO_FEATURES: readonly FeatureId[] = ['export.gif_large', 'export.gif_difference'];

export const PLAN_FEATURES: Record<PlanId, FeatureId[]> = {
  free: FEATURES.filter((feature) => !PRO_FEATURES.includes(feature)),
  pro: [...FEATURES],
};

/** The plan comparison as people read it (profile page, documentation). */
export const FEATURE_MATRIX: { label: string; detail: string; features: FeatureId[] }[] = [
  {
    label: 'All five tools',
    detail: 'Measure & Plan, Study & Simplify, Color & Mixing, Create a Grid, Compare & Correct',
    features: ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare'],
  },
  { label: 'Save images', detail: 'Grids, studies and comparisons as PNG', features: ['export.image'] },
  { label: 'Comparison GIFs', detail: 'Opacity pulse and blink, small and medium sizes', features: ['export.gif'] },
  { label: 'Large GIFs', detail: 'Up to 800 px, for sharing and printing', features: ['export.gif_large'] },
  { label: 'Compare + Difference GIFs', detail: 'Animations that highlight what differs', features: ['export.gif_difference'] },
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
};

/** Better of two plans (Pro outranks Free). */
export const betterPlan = (a: PlanId, b: PlanId | null): PlanId => (a === 'pro' || b === 'pro' ? 'pro' : 'free');

export const isPlanId = (value: unknown): value is PlanId => (PLAN_IDS as readonly unknown[]).includes(value);
