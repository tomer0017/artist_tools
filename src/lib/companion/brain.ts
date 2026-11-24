import type { Audience, CompanionSettings, CompanionTip, ScreenId, TipAction, ToolId, TriggerId } from './model';

// ─── What Sketchy suggests, and when (ADR-0024) ──────────────────────────────
// Pure, so every rule is tested once. A suggestion is a tip whose screen,
// moment (trigger), audience and "right after this tool" fit the person now,
// whose button they can really use (`can`: the tool, the Learn module, the
// worksheets…), chosen by weight and freshness: a tip seen in the last days
// comes back only when nothing else fits. Suggestions he offers on his own
// also respect the pace an admin set: seconds of quiet first, minutes between
// two, a daily cap, and a snooze after the person said "Not now". Tips asked
// for from his menu ignore the pace but still avoid repeats.
//
// The interface is deliberately small (context in, tip out), so a smarter
// provider (a conversational model behind a server endpoint) can stand in
// later without the studio changing: see SuggestionProvider.

export interface Memory {
  /** Each tip's last appearance (ms). */
  shown: Record<string, number>;
  /** The day (YYYY-MM-DD, local) `count` is about. */
  day: string;
  /** Suggestions he offered on his own that day. */
  count: number;
  /** When he last offered one on his own (ms). */
  lastTipAt: number;
  /** Quiet until then (ms) after "Not now". */
  snoozeUntil: number;
  /** When the person first met him (ms), or never yet. */
  metAt: number | null;
  /** The last day an `arrive` greeting was shown. */
  greetedDay: string | null;
}

export const EMPTY_MEMORY: Memory = { shown: {}, day: '', count: 0, lastTipAt: 0, snoozeUntil: 0, metAt: null, greetedDay: null };

export interface Context {
  screen: ScreenId;
  trigger: TriggerId;
  /** What the person said about themselves (or class mode: a teacher); null if they did not say. */
  audience: Audience | null;
  /** The tool used last in this visit, if any. */
  lastTool: ToolId | null;
  /** Whether the button of a tip would work for this person now. */
  can: (action: TipAction) => boolean;
  now: number;
  /** The local day (YYYY-MM-DD). */
  today: string;
}

/** Tips seen within this many days come back only when nothing fresher fits. */
export const FRESH_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROACTIVE: readonly TriggerId[] = ['idle', 'arrive', 'afterSave', 'afterComplete'];

/** Whether he may offer something on his own now (the pace); first meetings and menu tips are not limited. */
export function mayOffer(trigger: TriggerId, settings: Pick<CompanionSettings, 'cooldownMin' | 'maxPerDay'>, memory: Memory, now: number, today: string): boolean {
  if (!PROACTIVE.includes(trigger)) return true;
  if (now < memory.snoozeUntil) return false;
  // Celebrating something the person did is welcome even soon after another tip, but never past the daily cap.
  const count = memory.day === today ? memory.count : 0;
  if (count >= settings.maxPerDay) return false;
  if (trigger === 'afterSave' || trigger === 'afterComplete') return true;
  if (trigger === 'arrive' && memory.greetedDay === today) return false;
  return now - memory.lastTipAt >= settings.cooldownMin * 60_000;
}

/** Whether a tip fits the screen, moment, person and last tool (not yet the pace or freshness). */
export function fits(tip: CompanionTip, ctx: Context): boolean {
  if (tip.archived) return false;
  if (tip.trigger !== ctx.trigger) return false;
  if (ctx.trigger !== 'menu' && !tip.screens.includes(ctx.screen)) return false;
  if (tip.audience.length > 0 && (ctx.audience === null || !tip.audience.includes(ctx.audience))) return false;
  if (tip.afterTools && tip.afterTools.length > 0 && (ctx.lastTool === null || !tip.afterTools.includes(ctx.lastTool))) return false;
  return ctx.can(tip.action);
}

/** Weighted random choice among the freshest tips that fit; null when none does. */
export function pickTip(tips: readonly CompanionTip[], ctx: Context, memory: Memory, random: () => number = Math.random, avoid: readonly string[] = []): CompanionTip | null {
  const candidates = tips.filter((tip) => fits(tip, ctx));
  if (candidates.length === 0) return null;
  const notNow = new Set(avoid);
  const fresh = candidates.filter((tip) => !notNow.has(tip.id) && ctx.now - (memory.shown[tip.id] ?? 0) >= FRESH_DAYS * DAY_MS);
  const others = candidates.filter((tip) => !notNow.has(tip.id));
  // Nothing fresh: the one seen longest ago, rather than the same one again.
  const pool = fresh.length > 0 ? fresh : others.length > 0 ? [...others].sort((a, b) => (memory.shown[a.id] ?? 0) - (memory.shown[b.id] ?? 0)).slice(0, 3) : candidates;
  const total = pool.reduce((sum, tip) => sum + Math.max(1, tip.weight), 0);
  let roll = random() * total;
  for (const tip of pool) {
    roll -= Math.max(1, tip.weight);
    if (roll < 0) return tip;
  }
  return pool[pool.length - 1];
}

/** Memory after a tip appeared (proactive ones count toward the day and the cooldown). */
export function remember(memory: Memory, tip: Pick<CompanionTip, 'id' | 'trigger'>, now: number, today: string): Memory {
  const proactive = PROACTIVE.includes(tip.trigger);
  const count = memory.day === today ? memory.count : 0;
  return {
    ...memory,
    shown: pruneShown({ ...memory.shown, [tip.id]: now }, now),
    day: today,
    count: proactive ? count + 1 : count,
    lastTipAt: proactive ? now : memory.lastTipAt,
    greetedDay: tip.trigger === 'arrive' ? today : memory.greetedDay,
    metAt: memory.metAt ?? now,
  };
}

/** "Not now": quiet for the snooze the admin set. */
export const snooze = (memory: Memory, hours: number, now: number): Memory => ({ ...memory, snoozeUntil: now + hours * 60 * 60 * 1000 });

/** Forget appearances older than 60 days (the memory stays small). */
function pruneShown(shown: Record<string, number>, now: number): Record<string, number> {
  const keep: Record<string, number> = {};
  for (const [id, at] of Object.entries(shown)) if (now - at < 60 * DAY_MS) keep[id] = at;
  return keep;
}

/** Memory read back from this browser: anything unexpected falls back to the empty memory's value. */
export function readMemory(value: unknown): Memory {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  const shown: Record<string, number> = {};
  if (typeof v.shown === 'object' && v.shown !== null) {
    for (const [id, at] of Object.entries(v.shown as Record<string, unknown>).slice(0, 500)) if (/^T-\d{3,4}$/.test(id) && num(at) > 0) shown[id] = num(at);
  }
  const day = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  return {
    shown,
    day: day(v.day) ?? '',
    count: Math.min(100, Math.floor(num(v.count))),
    lastTipAt: num(v.lastTipAt),
    snoozeUntil: num(v.snoozeUntil),
    metAt: num(v.metAt) > 0 ? num(v.metAt) : null,
    greetedDay: day(v.greetedDay),
  };
}

/** The local day of a moment (YYYY-MM-DD). */
export const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Where suggestions come from. Today: `localProvider`, the rules above over
 * the published tips. A provider must only ever return one of the tips it is
 * given (so every button stays one of the safe action types) or null.
 */
export interface SuggestionProvider {
  suggest(tips: readonly CompanionTip[], ctx: Context, memory: Memory): CompanionTip | null;
}

export const localProvider: SuggestionProvider = { suggest: (tips, ctx, memory) => pickTip(tips, ctx, memory) };
