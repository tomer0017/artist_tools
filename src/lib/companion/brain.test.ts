import { describe, expect, it } from 'vitest';
import { EMPTY_MEMORY, FRESH_DAYS, affinity, dayOf, fits, mayOffer, pickTip, readMemory, remember, snooze, type Context, type Memory } from './brain';
import type { CompanionTip } from './model';

// What Sketchy suggests, and when (ADR-0024): the screen, the moment, the
// person and the last tool decide what fits; the pace an admin set decides
// whether he may speak up; freshness and weight choose among what fits.

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const TODAY = dayOf(NOW);
const DAY = 24 * 60 * 60 * 1000;

const tip = (id: string, extra: Partial<CompanionTip> = {}): CompanionTip => ({
  id,
  order: 10,
  category: 'tools',
  text: { en: `Tip ${id}`, he: `טיפ ${id}` },
  screens: ['home'],
  audience: [],
  trigger: 'idle',
  animation: 'holdSign',
  action: { type: 'openTool', label: { en: 'Open', he: 'לפתוח' }, tool: 'value' },
  access: 'free',
  weight: 5,
  ...extra,
});

const ctx = (extra: Partial<Context> = {}): Context => ({ screen: 'home', trigger: 'idle', audience: null, lastTool: null, can: () => true, now: NOW, today: TODAY, ...extra });
const memory = (extra: Partial<Memory> = {}): Memory => ({ ...EMPTY_MEMORY, ...extra });
const PACE = { cooldownMin: 45, maxPerDay: 5 };

describe('what fits', () => {
  it('needs the same moment and screen, and never an archived tip', () => {
    expect(fits(tip('T-001'), ctx())).toBe(true);
    expect(fits(tip('T-001', { trigger: 'arrive' }), ctx())).toBe(false);
    expect(fits(tip('T-001', { screens: ['learn'] }), ctx())).toBe(false);
    expect(fits(tip('T-001', { archived: true }), ctx())).toBe(false);
  });

  it('menu tips ignore the screen (they are asked for)', () => {
    expect(fits(tip('T-001', { trigger: 'menu', screens: [] }), ctx({ trigger: 'menu', screen: 'learn' }))).toBe(true);
  });

  it('a tip for teachers reaches only people who said they teach (or class mode); none ticked is everyone', () => {
    const forTeachers = tip('T-001', { audience: ['teacher'] });
    expect(fits(forTeachers, ctx({ audience: null }))).toBe(false);
    expect(fits(forTeachers, ctx({ audience: 'student' }))).toBe(false);
    expect(fits(forTeachers, ctx({ audience: 'teacher' }))).toBe(true);
    expect(fits(tip('T-002'), ctx({ audience: 'teacher' }))).toBe(true);
  });

  it('"right after this tool" needs that tool to be the one used last', () => {
    const afterStudy = tip('T-001', { afterTools: ['value'] });
    expect(fits(afterStudy, ctx())).toBe(false);
    expect(fits(afterStudy, ctx({ lastTool: 'grid' }))).toBe(false);
    expect(fits(afterStudy, ctx({ lastTool: 'value' }))).toBe(true);
  });

  it('never offers a button the person cannot use (a locked tool, closed Learn, no worksheets)', () => {
    expect(fits(tip('T-001'), ctx({ can: () => false }))).toBe(false);
  });
});

describe('the pace (he never nags)', () => {
  it('waits the cooldown between two suggestions of his own, and stops at the daily cap', () => {
    expect(mayOffer('idle', PACE, memory({ lastTipAt: NOW - 44 * 60_000 }), NOW, TODAY)).toBe(false);
    expect(mayOffer('idle', PACE, memory({ lastTipAt: NOW - 46 * 60_000 }), NOW, TODAY)).toBe(true);
    expect(mayOffer('idle', PACE, memory({ day: TODAY, count: 5 }), NOW, TODAY)).toBe(false);
    // Yesterday's count does not hold today.
    expect(mayOffer('idle', PACE, memory({ day: '2026-11-23', count: 5 }), NOW, TODAY)).toBe(true);
  });

  it('stays quiet after "Not now" until the snooze ends', () => {
    const snoozed = snooze(memory(), 24, NOW);
    expect(mayOffer('idle', PACE, snoozed, NOW + 23 * 60 * 60_000, TODAY)).toBe(false);
    expect(mayOffer('afterSave', PACE, snoozed, NOW + 60_000, TODAY)).toBe(false);
    expect(mayOffer('idle', PACE, snoozed, NOW + 25 * 60 * 60_000, dayOf(NOW + 25 * 60 * 60_000))).toBe(true);
  });

  it('celebrating what the person did ignores the cooldown, never the cap', () => {
    const justNow = memory({ lastTipAt: NOW - 60_000, day: TODAY, count: 2 });
    expect(mayOffer('afterSave', PACE, justNow, NOW, TODAY)).toBe(true);
    expect(mayOffer('afterComplete', PACE, memory({ day: TODAY, count: 5 }), NOW, TODAY)).toBe(false);
  });

  it('says hello once a day', () => {
    expect(mayOffer('arrive', PACE, memory({ greetedDay: TODAY }), NOW, TODAY)).toBe(false);
    expect(mayOffer('arrive', PACE, memory({ greetedDay: '2026-11-23' }), NOW, TODAY)).toBe(true);
  });

  it('first meetings and tips asked for from the menu are never held back', () => {
    const quiet = memory({ snoozeUntil: NOW + DAY, day: TODAY, count: 99 });
    expect(mayOffer('firstVisit', PACE, quiet, NOW, TODAY)).toBe(true);
    expect(mayOffer('menu', PACE, quiet, NOW, TODAY)).toBe(true);
  });
});

describe('choosing among what fits', () => {
  it('prefers tips not seen in the last days, and brings an old one back only when nothing fresher fits', () => {
    const tips = [tip('T-001'), tip('T-002')];
    const seen = memory({ shown: { 'T-001': NOW - 1000 } });
    for (let i = 0; i < 20; i++) expect(pickTip(tips, ctx(), seen, Math.random)?.id).toBe('T-002');
    const bothSeen = memory({ shown: { 'T-001': NOW - 5000, 'T-002': NOW - 1000 } });
    // Neither is fresh: the one seen longest ago comes first in line.
    expect(pickTip(tips, ctx(), bothSeen, () => 0)?.id).toBe('T-001');
    const old = memory({ shown: { 'T-001': NOW - (FRESH_DAYS + 1) * DAY } });
    expect(['T-001', 'T-002']).toContain(pickTip(tips, ctx(), old)?.id);
  });

  it('weights decide how often among fresh tips', () => {
    const tips = [tip('T-001', { weight: 9 }), tip('T-002', { weight: 1 })];
    expect(pickTip(tips, ctx(), memory(), () => 0.85)?.id).toBe('T-001');
    expect(pickTip(tips, ctx(), memory(), () => 0.95)?.id).toBe('T-002');
  });

  it('finds nothing rather than something that does not fit', () => {
    expect(pickTip([tip('T-001', { screens: ['learn'] })], ctx(), memory())).toBeNull();
    expect(pickTip([], ctx(), memory())).toBeNull();
  });

  it('can avoid the tip on screen ("Another tip")', () => {
    const tips = [tip('T-001', { trigger: 'menu' }), tip('T-002', { trigger: 'menu' })];
    for (let i = 0; i < 10; i++) expect(pickTip(tips, ctx({ trigger: 'menu' }), memory(), Math.random, ['T-001'])?.id).toBe('T-002');
  });
});

describe('what he remembers', () => {
  it('counts his own suggestions toward the day and the cooldown, not the ones asked for', () => {
    const after = remember(memory(), { id: 'T-001', trigger: 'idle' }, NOW, TODAY);
    expect(after).toMatchObject({ count: 1, lastTipAt: NOW, day: TODAY, metAt: NOW });
    expect(after.shown['T-001']).toBe(NOW);
    const asked = remember(after, { id: 'T-002', trigger: 'menu' }, NOW + 1000, TODAY);
    expect(asked).toMatchObject({ count: 1, lastTipAt: NOW });
    const greeted = remember(memory(), { id: 'T-003', trigger: 'arrive' }, NOW, TODAY);
    expect(greeted.greetedDay).toBe(TODAY);
  });

  it('reads back only sensible values from this browser', () => {
    expect(readMemory(null)).toEqual(EMPTY_MEMORY);
    expect(readMemory('nonsense')).toEqual(EMPTY_MEMORY);
    const read = readMemory({ shown: { 'T-001': 5, evil: 3, 'T-002': -1 }, day: '2026-11-24', count: 1e9, lastTipAt: 'x', snoozeUntil: 7, metAt: 0, greetedDay: 'today', rev: 2 });
    expect(read).toEqual({ shown: { 'T-001': 5 }, day: '2026-11-24', count: 100, lastTipAt: 0, snoozeUntil: 7, metAt: null, greetedDay: null, rev: 2 });
  });

  it('drops, once, a snooze kept from before ✕ stopped starting one (revision 2)', () => {
    const old = readMemory({ shown: {}, day: '2026-11-24', count: 3, lastTipAt: 1, snoozeUntil: NOW + DAY, metAt: 1, greetedDay: '2026-11-24' });
    expect(old).toMatchObject({ snoozeUntil: 0, count: 3, metAt: 1, greetedDay: '2026-11-24', rev: 2 });
    // Saved again at revision 2, a "Not now" holds.
    expect(readMemory({ ...snooze(old, 24, NOW), rev: 2 }).snoozeUntil).toBe(NOW + DAY);
  });

  it('suggests what follows on from the tool used last, and the same tool again less often', () => {
    const grid = tip('T-001', { action: { type: 'openTool', tool: 'grid', label: { en: 'Grid', he: 'רשת' } } });
    const compare = tip('T-002', { action: { type: 'openTool', tool: 'compare', label: { en: 'Compare', he: 'השוואה' } }, afterTools: ['grid'] });
    expect(affinity(grid, { lastTool: 'grid' })).toBeLessThan(affinity(grid, { lastTool: null }));
    expect(affinity(compare, { lastTool: 'grid' })).toBe(affinity(compare, { lastTool: null }) * 3);
  });

  it('forgets appearances older than 60 days', () => {
    const after = remember(memory({ shown: { 'T-009': NOW - 61 * DAY, 'T-008': NOW - DAY } }), { id: 'T-001', trigger: 'menu' }, NOW, TODAY);
    expect(Object.keys(after.shown).sort()).toEqual(['T-001', 'T-008']);
  });
});
