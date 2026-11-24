import { TOOL_IDS, type ToolId } from '@/lib/account';
import { ACCESS_MODES, ITEM_ID, type AccessMode, type Localized } from '@/lib/learn/model';
import { MOODS, type Mood } from '@/lib/learn/roulette';

// ─── Sketchy, the studio companion: the model (ADR-0024) ─────────────────────
// Shared by the server, which stores and filters the companion's settings and
// tips (kind `companion` in config_versions, edited in Admin → Companion), and
// the studio, which shows him. Everything an admin can choose is a value from
// a list defined here: an animation, a screen, an audience, a trigger and an
// action type. A tip never carries code or an address of its own: its action
// is one of ACTION_TYPES, and the studio performs it with the person's own
// access (a tool they may not open stays locked, a Learn item they may not
// open stays closed).

// ─── Animations ──────────────────────────────────────────────────────────────

export const ANIMATIONS = ['idle', 'walk', 'run', 'jump', 'sit', 'rest', 'wave', 'laugh', 'think', 'curious', 'celebrate', 'holdSign', 'point', 'draw'] as const;
export type AnimationId = (typeof ANIMATIONS)[number];

export const ANIMATION_LABELS: Record<AnimationId, string> = {
  idle: 'Standing (breathing, blinking)',
  walk: 'Walking',
  run: 'Running',
  jump: 'Jumping',
  sit: 'Sitting',
  rest: 'Resting (eyes closed)',
  wave: 'Waving',
  laugh: 'Laughing',
  think: 'Thinking',
  curious: 'Looking curious',
  celebrate: 'Celebrating',
  holdSign: 'Holding a sign',
  point: 'Pointing at a tool',
  draw: 'Drawing with a pencil',
};

/** Animations a tip can open with before he holds up its sign. */
export const TIP_ANIMATIONS = ['holdSign', 'wave', 'think', 'curious', 'point', 'draw', 'laugh', 'jump', 'celebrate'] as const satisfies readonly AnimationId[];
export type TipAnimation = (typeof TIP_ANIMATIONS)[number];

export const isAnimation = (value: unknown): value is AnimationId => (ANIMATIONS as readonly unknown[]).includes(value);

// ─── Where, for whom, when ───────────────────────────────────────────────────

/** Screens where he lives: the studio's Home (the tools dashboard) and the Learn home. */
export const SCREENS = ['home', 'learn'] as const;
export type ScreenId = (typeof SCREENS)[number];
export const SCREEN_LABELS: Record<ScreenId, string> = { home: 'Home (tools dashboard)', learn: 'Learn home' };

/** Who a tip is for; none chosen means everyone. The person says it themselves (account page or his menu). */
export const AUDIENCES = ['artist', 'student', 'teacher'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Audience, string> = { artist: 'Artists', student: 'Students', teacher: 'Teachers' };

/** The moment a tip may come up. Only `menu` tips wait to be asked for ("Give me a drawing tip"). */
export const TRIGGERS = ['idle', 'arrive', 'firstVisit', 'afterSave', 'afterComplete', 'menu'] as const;
export type TriggerId = (typeof TRIGGERS)[number];
export const TRIGGER_LABELS: Record<TriggerId, string> = {
  idle: 'After a quiet while on the screen',
  arrive: 'When the person arrives on the screen',
  firstVisit: 'The very first time they meet Sketchy',
  afterSave: 'After they saved or exported something',
  afterComplete: 'After they completed a lesson or challenge',
  menu: 'Only when asked ("Give me a drawing tip")',
};

export const TIP_CATEGORIES = ['welcome', 'inspiration', 'practice', 'tools', 'light', 'color', 'teaching', 'drawing', 'celebration'] as const;
export type TipCategory = (typeof TIP_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<TipCategory, string> = {
  welcome: 'Welcome',
  inspiration: 'Drawing inspiration',
  practice: 'Practice',
  tools: 'Tools',
  light: 'Light and shadow',
  color: 'Color',
  teaching: 'Teaching',
  drawing: 'Drawing tip',
  celebration: 'Celebration',
};

// ─── Actions: a fixed list, never code ───────────────────────────────────────

export const ACTION_TYPES = ['none', 'openTool', 'roulette', 'classRoulette', 'nextLesson', 'openLearn', 'openItem', 'worksheets', 'drawingTip', 'improve', 'chooseTool'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const ACTION_LABELS: Record<ActionType, string> = {
  none: 'No button (just the message)',
  openTool: 'Open a tool',
  roulette: 'Spin the challenge roulette',
  classRoulette: 'Class roulette (a challenge + practice sheets)',
  nextLesson: 'Open the next lesson of the course',
  openLearn: 'Open a Learn page',
  openItem: 'Open one lesson or challenge',
  worksheets: 'Make practice sheets (worksheets)',
  drawingTip: 'Show another drawing tip',
  improve: 'Help me improve my drawing',
  chooseTool: 'Help me choose a tool',
};

export const LEARN_PAGES = ['home', 'curriculum', 'challenges', 'history'] as const;
export type LearnPage = (typeof LEARN_PAGES)[number];

export interface TipAction {
  type: ActionType;
  /** The button's words (both languages); empty for `none`. */
  label: Localized;
  /** openTool. */
  tool?: ToolId;
  /** roulette: the effort to start from. */
  mood?: Mood;
  /** openLearn. */
  page?: LearnPage;
  /** openItem: a lesson or challenge ID. */
  itemId?: string;
}

// ─── Capabilities and their access (ADR-0024, like Learn's per-item modes) ──

export const COMPANION_FEATURES = ['companion', 'tips', 'roulette', 'guide', 'classroom'] as const;
export type CompanionFeature = (typeof COMPANION_FEATURES)[number];
export const COMPANION_FEATURE_LABELS: Record<CompanionFeature, { title: string; detail: string }> = {
  companion: { title: 'Sketchy himself', detail: 'He appears in the studio at all (off here hides everything below).' },
  tips: { title: 'Suggestions', detail: 'Tips he offers on his own, with their buttons.' },
  roulette: { title: 'Challenge roulette', detail: 'The animated wheel that picks a challenge the person may open.' },
  guide: { title: 'Guided help', detail: 'Drawing tips, "Help me improve my drawing", "Help me choose a tool", "Recommend a lesson".' },
  classroom: { title: 'Teacher tools', detail: 'Practice sheets and preparing a class (worksheets still need the Worksheets feature).' },
};

/** Which capability each action needs (besides the tool or Learn access it leads to). */
export const ACTION_FEATURE: Record<ActionType, CompanionFeature> = {
  none: 'tips',
  openTool: 'tips',
  roulette: 'roulette',
  classRoulette: 'classroom',
  nextLesson: 'guide',
  openLearn: 'tips',
  openItem: 'tips',
  worksheets: 'classroom',
  drawingTip: 'guide',
  improve: 'guide',
  chooseTool: 'guide',
};

// ─── Settings and tips ───────────────────────────────────────────────────────

export const FREQUENCIES = ['quiet', 'balanced', 'chatty'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * What each frequency means: seconds of quiet on a screen before a suggestion, minutes between
 * two, at most per day. Balanced (the default) helps now and then during a visit (the founder,
 * 2026-11-24: "occasionally pull out his sign"); quiet is for people who want little of it.
 */
export const FREQUENCY_PRESETS: Record<Frequency, { tipAfterSec: number; cooldownMin: number; maxPerDay: number }> = {
  quiet: { tipAfterSec: 45, cooldownMin: 240, maxPerDay: 2 },
  balanced: { tipAfterSec: 25, cooldownMin: 8, maxPerDay: 10 },
  chatty: { tipAfterSec: 12, cooldownMin: 3, maxPerDay: 20 },
};

export const LIMITS = {
  size: { min: 70, max: 140 },
  firstDelaySec: { min: 0, max: 60 },
  tipAfterSec: { min: 5, max: 600 },
  cooldownMin: { min: 1, max: 1440 },
  snoozeHours: { min: 1, max: 168 },
  maxPerDay: { min: 0, max: 20 },
  wanderEverySec: { min: 15, max: 900 },
  restAfterSec: { min: 30, max: 3600 },
  speed: { min: 50, max: 200 },
  text: 220,
  title: 60,
  label: 32,
  tips: 300,
  weight: { min: 1, max: 10 },
} as const;

export interface CompanionSettings {
  /** He appears in the studio at all. */
  enabled: boolean;
  /** His size, in percent of the standard size. */
  size: number;
  frequency: Frequency;
  /** Seconds on Home before he walks in. */
  firstDelaySec: number;
  /** Seconds of quiet on a screen before he offers a suggestion. */
  tipAfterSec: number;
  /** Minutes between two suggestions he offers on his own. */
  cooldownMin: number;
  /** Hours he stays quiet after the person dismisses a suggestion. */
  snoozeHours: number;
  /** Suggestions he offers on his own per day, at most. */
  maxPerDay: number;
  /** He walks between the free places of the screen now and then. */
  wander: boolean;
  wanderEverySec: number;
  /** Blinking, breathing, tail and ears while he stands or sits. */
  idleLife: boolean;
  /** He celebrates saves and completed lessons and challenges. */
  celebrate: boolean;
  /** After this long without anything to do he sits down to rest. */
  restAfterSec: number;
  /** Walking speed, in percent. */
  speed: number;
  /** Each animation on or off (off: he does something calmer instead). */
  animations: Record<AnimationId, boolean>;
}

export interface CompanionTip {
  /** T-001…: stable, never reused. */
  id: string;
  order: number;
  category: TipCategory;
  /** A short heading on the sign (optional). */
  title?: Localized;
  text: Localized;
  screens: ScreenId[];
  /** Only right after the person used one of these tools (none: any time). */
  afterTools?: ToolId[];
  /** None: everyone. */
  audience: Audience[];
  trigger: TriggerId;
  animation: TipAnimation;
  action: TipAction;
  /** Who sees it (Free: everyone signed in; Pro; Admin only, to check it first; Blocked). */
  access: AccessMode;
  /** How often it comes up compared with others (1–10). */
  weight: number;
  /** Deleted, recoverable: shown to nobody, listed under Archived. */
  archived?: boolean;
}

export interface CompanionConfig {
  settings: CompanionSettings;
  access: Record<CompanionFeature, AccessMode>;
  tips: CompanionTip[];
}

/** Every key Sketchy keeps in this browser starts with this (removed with this device's work, src/lib/device-data.ts). */
export const COMPANION_STORAGE_PREFIX = 'studio-companion';

export const TIP_ID = /^T-\d{3,4}$/;
export const isTipId = (value: unknown): value is string => typeof value === 'string' && TIP_ID.test(value);

/** Whether an action's own fields are complete (the server checks the same before saving). */
export function actionIssues(action: TipAction): string[] {
  const issues: string[] = [];
  if (action.type !== 'none' && (!action.label?.en?.trim() || !action.label?.he?.trim())) issues.push('the button needs its words in English and Hebrew');
  if (action.type === 'openTool' && !(TOOL_IDS as readonly unknown[]).includes(action.tool)) issues.push('choose the tool the button opens');
  if (action.type === 'openLearn' && !(LEARN_PAGES as readonly unknown[]).includes(action.page)) issues.push('choose the Learn page the button opens');
  if (action.type === 'openItem' && !(typeof action.itemId === 'string' && ITEM_ID.test(action.itemId))) issues.push('the button needs a lesson or challenge ID (D-…-01 or CH-001)');
  if (action.mood !== undefined && !(MOODS as readonly unknown[]).includes(action.mood)) issues.push('the roulette mood is not one of light, create, challenge or surprise');
  return issues;
}

export { ACCESS_MODES, MOODS, TOOL_IDS };
export type { AccessMode, Localized, Mood, ToolId };
