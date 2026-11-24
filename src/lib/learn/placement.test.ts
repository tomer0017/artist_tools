// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ORDER_STEP, canMove, endOfGroup, moveWithinGroup, placeAfter, sequence, type GroupOrder, type Placed } from './placement';

// Moving items within their group, joining a group at its end, and copies
// right after their original, with as few new numbers as possible (ADR-0023).

const item = (id: string, groupId: string, order: number): Placed => ({ id, collection: 'curriculum', groupId, order });
const GROUPS: GroupOrder[] = [
  { id: 'lines', collection: 'curriculum', order: 1 },
  { id: 'build', collection: 'curriculum', order: 2 },
  { id: 'empty', collection: 'curriculum', order: 3 },
  { id: 'forms', collection: 'curriculum', order: 4 },
];
const ITEMS = [item('D-A-01', 'lines', 1), item('D-A-02', 'lines', 2), item('D-A-03', 'lines', 3), item('D-B-01', 'build', 4), item('D-B-02', 'build', 5), item('D-C-01', 'forms', 6)];

const apply = (items: Placed[], changes: Map<string, number>) => sequence(items.map((i) => ({ ...i, order: changes.get(i.id) ?? i.order })), 'curriculum').map((i) => i.id);

describe('placing Learn items', () => {
  it('moving up or down within a group swaps two neighbours and nothing else', () => {
    const changes = moveWithinGroup(ITEMS, 'curriculum', 'D-A-02', 'up');
    expect([...changes]).toEqual([['D-A-02', 1], ['D-A-01', 2]]);
    expect(apply(ITEMS, changes).slice(0, 3)).toEqual(['D-A-02', 'D-A-01', 'D-A-03']);
    expect(apply(ITEMS, moveWithinGroup(ITEMS, 'curriculum', 'D-A-02', 'down')).slice(0, 3)).toEqual(['D-A-01', 'D-A-03', 'D-A-02']);
  });

  it('the first and last of a group do not move past it', () => {
    expect(moveWithinGroup(ITEMS, 'curriculum', 'D-A-01', 'up').size).toBe(0);
    expect(moveWithinGroup(ITEMS, 'curriculum', 'D-A-03', 'down').size).toBe(0);
    expect(canMove(ITEMS, 'curriculum', 'D-B-01')).toEqual({ up: false, down: true });
    expect(canMove(ITEMS, 'curriculum', 'D-C-01')).toEqual({ up: false, down: false });
  });

  it('a group’s end: its last item; an empty group follows the nearest group before it', () => {
    expect(endOfGroup(ITEMS, GROUPS, 'curriculum', 'lines')).toBe('D-A-03');
    expect(endOfGroup(ITEMS, GROUPS, 'curriculum', 'empty')).toBe('D-B-02');
    expect(endOfGroup([], GROUPS, 'curriculum', 'lines')).toBeNull();
  });

  it('a free number between the new neighbours is used when there is one', () => {
    const spaced = ITEMS.map((i) => ({ ...i, order: i.order * 10 }));
    const changes = placeAfter(spaced, 'curriculum', 'D-C-01', 'D-A-01');
    expect([...changes]).toEqual([['D-C-01', 15]]);
    expect(apply(spaced, changes).slice(0, 3)).toEqual(['D-A-01', 'D-C-01', 'D-A-02']);
  });

  it('with no free number, the collection is numbered afresh, ORDER_STEP apart, in the new order', () => {
    const copy = item('D-A-04', 'lines', 1); // a copy of D-A-01, same number
    const all = [...ITEMS, copy];
    const changes = placeAfter(all, 'curriculum', 'D-A-04', 'D-A-01');
    expect(apply(all, changes)).toEqual(['D-A-01', 'D-A-04', 'D-A-02', 'D-A-03', 'D-B-01', 'D-B-02', 'D-C-01']);
    expect(changes.get('D-A-01')).toBe(ORDER_STEP);
    expect(changes.get('D-C-01')).toBe(7 * ORDER_STEP);
  });

  it('an item already in place is not renumbered; at the end it takes a number past the last', () => {
    expect(placeAfter(ITEMS, 'curriculum', 'D-A-02', 'D-A-01').size).toBe(0);
    expect([...placeAfter(ITEMS, 'curriculum', 'D-A-01', 'D-C-01')]).toEqual([['D-A-01', 6 + ORDER_STEP]]);
  });
});
