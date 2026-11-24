import type { AccountSummary } from '@/lib/account';
import { TOOL_FEATURES, type FeatureId } from '@/lib/plans';
import { ACTION_FEATURE, type CompanionFeature, type TipAction, type ToolId } from './model';

// ─── What Sketchy knows about the studio (ADR-0024) ──────────────────────────
// One registry of the studio's real capabilities, so he never offers what
// does not exist: the five tools (their names and descriptions are the
// studio's own messages, `tools.<id>`), what each helps an artist with, which
// tools work well together (short plans of existing tools), Learn's course
// and challenges, and the worksheets. Each entry names the feature the
// server must have granted (FeatureId) — the same list the studio uses to
// open a tool — so a locked tool is shown as locked, never as working.
// Adding a tool to the studio means adding it here (the registry test fails
// until every tool has an entry).

/** What an artist may want help with ("What would you like to improve?"). */
export const NEEDS = ['proportions', 'values', 'color', 'transfer', 'check'] as const;
export type Need = (typeof NEEDS)[number];

export interface ToolCapability {
  tool: ToolId;
  /** The server's feature that opens it. */
  feature: FeatureId;
  /** What it helps with, best first. */
  helps: Need[];
  /** Tools it combines well with, in the order they usually follow. */
  pairs: ToolId[];
}

export const TOOL_CAPABILITIES: Record<ToolId, ToolCapability> = {
  measure: { tool: 'measure', feature: TOOL_FEATURES.measure, helps: ['proportions'], pairs: ['grid', 'compare'] },
  value: { tool: 'value', feature: TOOL_FEATURES.value, helps: ['values'], pairs: ['grid', 'color'] },
  color: { tool: 'color', feature: TOOL_FEATURES.color, helps: ['color'], pairs: ['value'] },
  grid: { tool: 'grid', feature: TOOL_FEATURES.grid, helps: ['transfer', 'proportions'], pairs: ['compare', 'measure'] },
  compare: { tool: 'compare', feature: TOOL_FEATURES.compare, helps: ['check', 'proportions', 'values'], pairs: ['measure', 'value'] },
};

/** The tools for a need, best first. */
export const toolsFor = (need: Need): ToolId[] =>
  (Object.values(TOOL_CAPABILITIES) as ToolCapability[])
    .filter((c) => c.helps.includes(need))
    .sort((a, b) => a.helps.indexOf(need) - b.helps.indexOf(need))
    .map((c) => c.tool);

/** Short plans that chain existing tools (each step opens one tool). */
export const RECIPES = {
  photoToDrawing: ['value', 'grid', 'compare'],
  fixProportions: ['measure', 'compare'],
  paintColors: ['value', 'color'],
} as const satisfies Record<string, readonly ToolId[]>;
export type RecipeId = keyof typeof RECIPES;

/** What the person can do now, from the account the server sent (never a guess). */
export interface Abilities {
  tool: (tool: ToolId) => 'open' | 'locked' | 'absent';
  /** Learn's course (lessons) and challenges: open, locked (Pro opens it) or not shown. */
  course: 'open' | 'locked' | null;
  challenges: 'open' | 'locked' | null;
  /** Prepare Worksheets (`export.worksheets`, ADR-0016). */
  worksheets: boolean;
  /** Sketchy's own capabilities (Admin → Companion access). */
  companion: (feature: CompanionFeature) => boolean;
}

export function abilitiesOf(account: Pick<AccountSummary, 'features' | 'offer' | 'learn'> | null, companion: Partial<Record<CompanionFeature, 'open' | 'locked' | 'hidden'>>): Abilities {
  const features = account?.features ?? [];
  const offered = (f: FeatureId) => account?.offer.free.includes(f) === true || account?.offer.pro.includes(f) === true;
  return {
    tool: (tool) => (features.includes(TOOL_FEATURES[tool]) ? 'open' : offered(TOOL_FEATURES[tool]) ? 'locked' : 'absent'),
    course: account?.learn.visible ? account.learn.modules.curriculum : null,
    challenges: account?.learn.visible ? account.learn.modules.challenges : null,
    worksheets: features.includes('export.worksheets'),
    companion: (feature) => companion[feature] === 'open',
  };
}

/**
 * Whether a tip's button would really work for this person now: Sketchy's
 * capability is open to them, and what it leads to is open too (a tool
 * that is locked or absent, Learn not shown or locked, worksheets missing:
 * the tip is not offered).
 */
export function canRun(action: TipAction, can: Abilities): boolean {
  if (!can.companion('companion') || !can.companion(ACTION_FEATURE[action.type])) return false;
  switch (action.type) {
    case 'none':
    case 'drawingTip':
    case 'improve':
    case 'chooseTool':
      return true;
    case 'openTool':
      return action.tool !== undefined && can.tool(action.tool) === 'open';
    case 'roulette':
      return can.challenges === 'open';
    case 'classRoulette':
      return can.challenges === 'open';
    case 'nextLesson':
      return can.course === 'open';
    case 'openLearn':
      if (action.page === 'curriculum') return can.course === 'open';
      if (action.page === 'challenges') return can.challenges === 'open';
      return can.course === 'open' || can.challenges === 'open';
    case 'openItem':
      // The item's own access is decided when it opens; its collection must be shown at least.
      return action.itemId?.startsWith('CH-') ? can.challenges === 'open' : can.course === 'open';
    case 'worksheets':
      return can.worksheets && can.tool('grid') === 'open';
    default:
      return false;
  }
}
