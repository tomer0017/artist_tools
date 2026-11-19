// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { collectionOfId, firstN, groupItems, isItemId, outlineOf, selectionDrift, type ContentLike } from './model';

// First N, whole groups and their drift (ADR-0017): resolved when an admin
// chooses them, frozen when published; drift is only ever shown, never applied.

const item = (id: string, groupId: string, order: number, published = true) => ({ id, collection: (id.startsWith('D-') ? 'curriculum' : 'color') as 'curriculum' | 'color', groupId, order, published });
const CONTENT: ContentLike = {
  exercises: [item('D-START-01', 'core', 1), item('D-SHAPE-01', 'core', 2), item('D-LINE-04', 'core', 3, false), item('D-OBS-02', 'core', 4), item('D-COPY-01', 'next', 13)],
  challenges: [
    { id: 'CH-002', groupId: 'everyday', order: 2, published: true },
    { id: 'CH-012', groupId: 'plants', order: 12, published: true },
  ],
};

describe('item IDs', () => {
  it('say their collection', () => {
    expect(['D-START-01', 'C-COL-01', 'CH-017', 'X-1', 'CH-17', 'd-start-01'].map((id) => [isItemId(id), collectionOfId(id)])).toEqual([
      [true, 'curriculum'],
      [true, 'color'],
      [true, 'challenges'],
      [false, null],
      [false, null],
      [false, null],
    ]);
  });
});

describe('First N and whole groups', () => {
  it('count published items in the current order, never more than exist', () => {
    expect(firstN(CONTENT, 'curriculum', 3)).toEqual(['D-START-01', 'D-SHAPE-01', 'D-OBS-02']);
    expect(firstN(CONTENT, 'curriculum', 99)).toEqual(['D-START-01', 'D-SHAPE-01', 'D-OBS-02', 'D-COPY-01']);
    expect(firstN(CONTENT, 'challenges', 1)).toEqual(['CH-002']);
    expect(groupItems(CONTENT, 'curriculum', 'next')).toEqual(['D-COPY-01']);
  });

  it('a list made by First N reports drift when the order changed, and the list itself stays', () => {
    const rule = { mode: 'selected' as const, items: ['D-START-01', 'D-SHAPE-01'], made: { by: 'first' as const, n: 2, contentVersion: 1 } };
    expect(selectionDrift(CONTENT, 'curriculum', rule)).toBeNull();
    const moved: ContentLike = { ...CONTENT, exercises: CONTENT.exercises.map((e) => (e.id === 'D-OBS-02' ? { ...e, order: 0 } : e)) };
    expect(selectionDrift(moved, 'curriculum', rule)).toEqual(['D-OBS-02', 'D-START-01']);
    expect(rule.items).toEqual(['D-START-01', 'D-SHAPE-01']);
    expect(selectionDrift(moved, 'curriculum', { mode: 'selected', items: ['D-START-01'], made: { by: 'pick' } })).toBeNull();
  });

  it('the outline the editors get has no instructions', () => {
    const text = (s: string) => ({ en: s, he: s });
    const outline = outlineOf({
      groups: [{ id: 'core', collection: 'curriculum', order: 1, title: text('Core') }],
      exercises: [{ ...item('D-START-01', 'core', 1), title: text('t'), objective: text('o'), materials: text('m'), instruction: text('secret'), mistake: { mistake: text('a'), fix: text('b') }, success: text('s'), references: [], worksheet: { kind: 'none' }, tools: [] }],
      challenges: [],
    });
    expect(JSON.stringify(outline)).not.toContain('secret');
    expect(outline.exercises[0]).toEqual({ id: 'D-START-01', collection: 'curriculum', groupId: 'core', order: 1, published: true, title: text('t') });
  });
});
