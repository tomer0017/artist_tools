// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NO_LEGACY, accessModeOf, learnAccess, legacyLearnOf, type LearnViewer, type LegacyLearn } from './access';
import { NO_RULES, type AccessMode, type LearnContent } from './model';

// The Learn resolver's full matrix (ADR-0023): inactive → nothing; archived
// and Blocked → nobody, admins included; admin → the rest; Admin only →
// admins; Free → everyone signed in; Pro → Pro, listed as locked to others.
// Items written before modes get the access the old plan rules gave them.

const text = (s: string) => ({ en: s, he: s });
const exercise = (id: string, order: number, published: boolean, access?: AccessMode, archived?: boolean) => ({
  id,
  collection: 'curriculum' as const,
  groupId: 'core',
  order,
  published,
  ...(access ? { access } : {}),
  ...(archived ? { archived } : {}),
  title: text(id),
  objective: text('o'),
  materials: text('m'),
  instruction: text('i'),
  mistake: { mistake: text('a'), fix: text('b') },
  success: text('s'),
  references: [],
  worksheet: { kind: 'none' as const },
  tools: [],
});
const challenge = (id: string, order: number, published: boolean, access?: AccessMode) => ({
  id,
  groupId: 'objects',
  order,
  published,
  ...(access ? { access } : {}),
  title: text(id),
  prompt: text('p'),
  level: 'beginner' as const,
  skill: text('k'),
  skillArea: 3,
  reference: 'life' as const,
  references: [],
  medium: 'pencil' as const,
  quick: true,
  tools: [],
});

const CONTENT: LearnContent = {
  groups: [],
  exercises: [
    exercise('D-FREE-01', 1, true, 'free'),
    exercise('D-PRO-01', 2, false, 'pro'),
    exercise('D-ADM-01', 3, false, 'admin'),
    exercise('D-BLK-01', 4, false, 'blocked'),
    exercise('D-ARC-01', 5, false, 'free', true),
  ],
  challenges: [challenge('CH-001', 1, true, 'free'), challenge('CH-002', 2, false, 'pro')],
};

const viewer = (over: Partial<LearnViewer> = {}): LearnViewer => ({ active: true, admin: false, pro: false, legacy: NO_LEGACY, ...over });
const IDS = ['D-FREE-01', 'D-PRO-01', 'D-ADM-01', 'D-BLK-01', 'D-ARC-01', 'CH-001', 'CH-002', 'CH-999'];

const states = (v: LearnViewer, content: LearnContent = CONTENT) => {
  const view = learnAccess(v, content);
  return Object.fromEntries(IDS.map((id) => [id, view.state(id).status === 'locked' ? `locked:${(view.state(id) as { reason: string }).reason}` : view.state(id).status]));
};

describe('who may open which Learn item (access modes)', () => {
  it('an account that is not active gets nothing, admin or Pro or not', () => {
    for (const over of [{}, { admin: true }, { pro: true }]) expect(Object.values(states(viewer({ active: false, ...over })))).toEqual(Array(IDS.length).fill('hidden'));
  });

  it('Free: Free items open, Pro items locked (listed), Admin only, Blocked and archived hidden', () => {
    expect(states(viewer())).toEqual({
      'D-FREE-01': 'open', 'D-PRO-01': 'locked:not_in_plan', 'D-ADM-01': 'hidden', 'D-BLK-01': 'hidden', 'D-ARC-01': 'hidden', 'CH-001': 'open', 'CH-002': 'locked:not_in_plan', 'CH-999': 'hidden',
    });
  });

  it('Pro (paid, given or assigned): Free and Pro items open; nothing else', () => {
    expect(states(viewer({ pro: true }))).toEqual({
      'D-FREE-01': 'open', 'D-PRO-01': 'open', 'D-ADM-01': 'hidden', 'D-BLK-01': 'hidden', 'D-ARC-01': 'hidden', 'CH-001': 'open', 'CH-002': 'open', 'CH-999': 'hidden',
    });
  });

  it('an admin opens Free, Pro and Admin only items; Blocked and archived are hidden from admins too in the studio', () => {
    expect(states(viewer({ admin: true }))).toEqual({
      'D-FREE-01': 'open', 'D-PRO-01': 'open', 'D-ADM-01': 'open', 'D-BLK-01': 'hidden', 'D-ARC-01': 'hidden', 'CH-001': 'open', 'CH-002': 'open', 'CH-999': 'hidden',
    });
  });

  it('lists show open and Pro-locked items in order, with thumbnails; opens() lists only what opens', () => {
    const free = learnAccess(viewer(), CONTENT);
    expect(free.list('curriculum').map(({ item, state }) => `${item.id}:${state.status}`)).toEqual(['D-FREE-01:open', 'D-PRO-01:locked']);
    expect(free.opens('curriculum')).toEqual(['D-FREE-01']);
    expect(free.thumbnail('D-PRO-01')).toBe(true);
    expect(free.thumbnail('D-ADM-01')).toBe(false);
    expect(learnAccess(viewer({ admin: true }), CONTENT).list('curriculum').map(({ item }) => item.id)).toEqual(['D-FREE-01', 'D-PRO-01', 'D-ADM-01']);
  });

  it('the plan rules never change an item that has its own mode', () => {
    const open: LegacyLearn = { free: { modules: ['learn.curriculum', 'learn.challenges'], rules: { curriculum: { mode: 'all' }, color: { mode: 'all' }, challenges: { mode: 'all' } } }, pro: null };
    expect(states(viewer({ legacy: open }))).toEqual(states(viewer()));
    const closed: LegacyLearn = { free: null, pro: null };
    expect(states(viewer({ legacy: closed }))).toEqual(states(viewer()));
  });

  it('a mode this release does not know counts as Blocked', () => {
    const odd = { ...CONTENT, exercises: [{ ...exercise('D-ODD-01', 1, true), access: 'sculptors' as AccessMode }] };
    expect(learnAccess(viewer({ admin: true }), odd).state('D-ODD-01').status).toBe('hidden');
    expect(accessModeOf({ id: 'D-ODD-01', collection: 'curriculum', published: true, access: 'sculptors' }, NO_LEGACY)).toBe('blocked');
  });
});

describe('items written before modes keep the access the old rules gave them', () => {
  // As on production in catalog v8: Free opens one lesson and every challenge; Pro opens everything.
  const legacy = legacyLearnOf({
    free: { active: true, features: ['tool.grid', 'learn.curriculum', 'learn.challenges'], learn: { rules: { ...NO_RULES(), curriculum: { mode: 'selected', items: ['D-OLD-01'] }, challenges: { mode: 'all' } } } },
    pro: { active: true, features: ['learn.curriculum', 'learn.challenges'], learn: { rules: { curriculum: { mode: 'all' }, color: { mode: 'none' }, challenges: { mode: 'all' } } } },
  });
  const OLD: LearnContent = { groups: [], exercises: [exercise('D-OLD-01', 1, true), exercise('D-OLD-02', 2, true), exercise('D-OLD-03', 3, false)], challenges: [challenge('CH-010', 1, true)] };

  it('derives Free, Pro and Admin only exactly as the old resolver decided', () => {
    const mode = (id: string) => learnAccess(viewer({ legacy }), OLD).mode(id);
    expect(['D-OLD-01', 'D-OLD-02', 'D-OLD-03', 'CH-010'].map(mode)).toEqual(['free', 'pro', 'admin', 'free']);
    const free = learnAccess(viewer({ legacy }), OLD);
    expect(free.opens('curriculum')).toEqual(['D-OLD-01']);
    expect(free.state('D-OLD-02')).toEqual({ status: 'locked', reason: 'not_in_plan' });
    expect(learnAccess(viewer({ legacy, pro: true }), OLD).opens('curriculum')).toEqual(['D-OLD-01', 'D-OLD-02']);
  });

  it('a module no plan includes, or a plan switched off, opens nothing (Admin only)', () => {
    expect(learnAccess(viewer({ legacy: NO_LEGACY }), OLD).mode('D-OLD-01')).toBe('admin');
    const off = legacyLearnOf({ free: { active: false, features: ['learn.curriculum'], learn: { rules: { ...NO_RULES(), curriculum: { mode: 'all' } } } } });
    expect(off.free).toBeNull();
  });
});
