// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { learnAccess, type LearnViewer } from './access';
import { ALL_LEARN_ACCESS, NO_LEARN_ACCESS, NO_RULES, type LearnContent, type LearnRules } from './model';

// The Learn resolver's full rule matrix (ADR-0017, docs/learn/05 §4):
// inactive → nothing; admin → everything; unpublished → hidden; module off →
// locked; then All, None or the frozen Selected list.

const text = (s: string) => ({ en: s, he: s });
const exercise = (id: string, collection: 'curriculum' | 'color', order: number, published: boolean) => ({
  id,
  collection,
  groupId: collection === 'curriculum' ? 'core' : 'paint',
  order,
  published,
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
const challenge = (id: string, order: number, published: boolean) => ({
  id,
  groupId: 'objects',
  order,
  published,
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
  exercises: [exercise('D-A-01', 'curriculum', 2, true), exercise('D-B-01', 'curriculum', 1, true), exercise('D-C-01', 'curriculum', 3, false), exercise('C-A-01', 'color', 1, true)],
  challenges: [challenge('CH-001', 1, true), challenge('CH-002', 2, true), challenge('CH-003', 3, false)],
};

const viewer = (over: Partial<LearnViewer> & { rules?: Partial<LearnRules> } = {}): LearnViewer => ({
  active: true,
  admin: false,
  modules: ['learn.curriculum', 'learn.color', 'learn.challenges'],
  offered: [],
  ...over,
  access: { rules: { ...NO_RULES(), ...over.rules }, previews: over.access?.previews ?? 'title' },
});

const states = (v: LearnViewer) => {
  const view = learnAccess(v, CONTENT);
  return Object.fromEntries(['D-A-01', 'D-B-01', 'D-C-01', 'C-A-01', 'CH-001', 'CH-002', 'CH-003', 'CH-999'].map((id) => [id, view.state(id).status === 'locked' ? `locked:${(view.state(id) as { reason: string }).reason}` : view.state(id).status]));
};

describe('who may open which Learn item', () => {
  it('an account that is not active gets nothing, admin or not', () => {
    for (const admin of [false, true]) {
      expect(Object.values(states(viewer({ active: false, admin, rules: { curriculum: { mode: 'all' }, color: { mode: 'all' }, challenges: { mode: 'all' } } })))).toEqual(Array(8).fill('hidden'));
    }
  });

  it('an admin opens every item, unpublished ones included, whatever the plan says; unknown IDs stay hidden', () => {
    expect(states(viewer({ admin: true, modules: [], access: NO_LEARN_ACCESS() }))).toEqual({
      'D-A-01': 'open', 'D-B-01': 'open', 'D-C-01': 'open', 'C-A-01': 'open', 'CH-001': 'open', 'CH-002': 'open', 'CH-003': 'open', 'CH-999': 'hidden',
    });
  });

  it('unpublished items are hidden from everyone else, even with All', () => {
    const s = states(viewer({ rules: { curriculum: { mode: 'all' }, challenges: { mode: 'all' } } }));
    expect(s['D-C-01']).toBe('hidden');
    expect(s['CH-003']).toBe('hidden');
  });

  it('a module missing from the plan locks all its items, whatever the rule', () => {
    const s = states(viewer({ modules: ['learn.challenges'], rules: { curriculum: { mode: 'all' }, color: { mode: 'all' }, challenges: { mode: 'all' } } }));
    expect(s).toMatchObject({ 'D-A-01': 'locked:module_off', 'D-B-01': 'locked:module_off', 'C-A-01': 'locked:module_off', 'CH-001': 'open', 'CH-002': 'open' });
  });

  it('then the rule: None locks, All opens every published item, Selected opens exactly the list', () => {
    expect(states(viewer())).toMatchObject({ 'D-A-01': 'locked:not_in_plan', 'C-A-01': 'locked:not_in_plan', 'CH-001': 'locked:not_in_plan' });
    expect(states(viewer({ rules: { curriculum: { mode: 'all' } } }))).toMatchObject({ 'D-A-01': 'open', 'D-B-01': 'open', 'C-A-01': 'locked:not_in_plan' });
    const selected = states(viewer({ rules: { challenges: { mode: 'selected', items: ['CH-002', 'CH-003', 'CH-999'] } } }));
    expect(selected).toMatchObject({ 'CH-001': 'locked:not_in_plan', 'CH-002': 'open', 'CH-003': 'hidden', 'CH-999': 'hidden' });
  });

  it('a Selected list counts only for its own collection', () => {
    const s = states(viewer({ rules: { curriculum: { mode: 'selected', items: ['C-A-01', 'CH-001'] } } }));
    expect(s).toMatchObject({ 'C-A-01': 'locked:not_in_plan', 'CH-001': 'locked:not_in_plan', 'D-A-01': 'locked:not_in_plan' });
  });

  it('reordering content changes nothing: a list names IDs, never positions', () => {
    const rules: Partial<LearnRules> = { curriculum: { mode: 'selected', items: ['D-B-01'], made: { by: 'first', n: 1, contentVersion: 1 } } };
    const before = learnAccess(viewer({ rules }), CONTENT).opens('curriculum');
    const reordered: LearnContent = { ...CONTENT, exercises: CONTENT.exercises.map((e) => (e.id === 'D-A-01' ? { ...e, order: 0 } : e)) };
    expect(learnAccess(viewer({ rules }), reordered).opens('curriculum')).toEqual(before);
    expect(before).toEqual(['D-B-01']);
  });
});

describe('what lists may show', () => {
  it('a module no plan offers is not listed at all; one another plan offers is listed locked', () => {
    const none = learnAccess(viewer({ modules: [] }), CONTENT);
    expect(none.list('curriculum')).toEqual([]);
    const offered = learnAccess(viewer({ modules: [], offered: ['learn.curriculum'] }), CONTENT);
    expect(offered.list('curriculum').map(({ item, state }) => `${item.id}:${state.status}`)).toEqual(['D-B-01:locked', 'D-A-01:locked']);
  });

  it('lists follow the content order and never show unpublished items to anyone but admins', () => {
    const view = learnAccess(viewer({ rules: { curriculum: { mode: 'all' } } }), CONTENT);
    expect(view.list('curriculum').map(({ item }) => item.id)).toEqual(['D-B-01', 'D-A-01']);
    expect(learnAccess(viewer({ admin: true }), CONTENT).list('curriculum').map(({ item }) => item.id)).toEqual(['D-B-01', 'D-A-01', 'D-C-01']);
  });

  it('thumbnails: for open items, and for listed locked items only while previews allow them', () => {
    const titles = learnAccess(viewer({ rules: { challenges: { mode: 'selected', items: ['CH-001'] } } }), CONTENT);
    expect([titles.thumbnail('CH-001'), titles.thumbnail('CH-002'), titles.thumbnail('CH-003')]).toEqual([true, false, false]);
    const previews = learnAccess({ ...viewer({ rules: { challenges: { mode: 'selected', items: ['CH-001'] } } }), access: { rules: { ...NO_RULES(), challenges: { mode: 'selected', items: ['CH-001'] } }, previews: 'thumbnail' } }, CONTENT);
    expect([previews.thumbnail('CH-001'), previews.thumbnail('CH-002'), previews.thumbnail('CH-003')]).toEqual([true, true, false]);
    // A locked module no plan offers shows nothing, thumbnails included.
    const off = learnAccess({ ...viewer({ modules: [] }), access: { ...ALL_LEARN_ACCESS() } }, CONTENT);
    expect(off.thumbnail('CH-001')).toBe(false);
  });
});
