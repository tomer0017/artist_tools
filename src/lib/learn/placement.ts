import type { LearnCollection } from './model';

// ─── Where an item goes in its collection (ADR-0023) ──────────────────────────
// A collection's order is its items' `order`, then their IDs (orderedItems):
// lesson numbers and every list follow it, and the course shows it unit by
// unit. Admin → Learn moves an item up or down within its group, puts a new
// or regrouped item at the end of its group, and a duplicate right after its
// original. Each move changes as few items' `order` as it can: two swapped,
// or the moved one given a free number between its neighbours; only when no
// number is free is the collection numbered afresh. Pure, so the rules are
// tested once.

export interface Placed {
  id: string;
  collection: LearnCollection;
  groupId: string;
  order: number;
}

export interface GroupOrder {
  id: string;
  collection: LearnCollection;
  order: number;
}

const byOrder = (a: Placed, b: Placed) => a.order - b.order || a.id.localeCompare(b.id);

/** The collection in display order. */
export const sequence = (items: readonly Placed[], collection: LearnCollection): Placed[] => items.filter((item) => item.collection === collection).sort(byOrder);

/** The gap between numbers when a collection is numbered afresh (room to insert later without renumbering). */
export const ORDER_STEP = 10;

/**
 * New `order` values for the collection once `id` sits right after `afterId`
 * (null: first). The moved item takes a free number between its new
 * neighbours (the middle of the gap); only when there is none is the whole
 * collection numbered afresh, ORDER_STEP apart, in the new order.
 */
export function placeAfter(items: readonly Placed[], collection: LearnCollection, id: string, afterId: string | null): Map<string, number> {
  const seq = sequence(items, collection);
  const moved = seq.find((item) => item.id === id);
  if (!moved) return new Map();
  const rest = seq.filter((item) => item.id !== id);
  const at = afterId === null ? 0 : rest.findIndex((item) => item.id === afterId) + 1;
  if (afterId !== null && at === 0) return new Map();
  const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
  const low = at > 0 ? next[at - 1].order : -1;
  const high = at + 1 < next.length ? next[at + 1].order : Number.POSITIVE_INFINITY;
  if (moved.order > low && moved.order < high) return new Map();
  if (high - low >= 2) return new Map([[id, Number.isFinite(high) ? Math.floor((low + high) / 2) : low + ORDER_STEP]]);
  const changes = new Map<string, number>();
  next.forEach((item, index) => {
    const order = (index + 1) * ORDER_STEP;
    if (order !== item.order) changes.set(item.id, order);
  });
  return changes;
}

/**
 * Where the end of a group is: the item an item joining it goes right after
 * (its last item, `except` left out). An empty group follows the last item of
 * the nearest group before it; with none, it is the collection's start (null).
 */
export function endOfGroup(items: readonly Placed[], groups: readonly GroupOrder[], collection: LearnCollection, groupId: string, except: string | null = null): string | null {
  const seq = sequence(items, collection).filter((item) => item.id !== except);
  const own = seq.filter((item) => item.groupId === groupId);
  if (own.length > 0) return own[own.length - 1].id;
  const ordered = groups.filter((g) => g.collection === collection).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const index = ordered.findIndex((g) => g.id === groupId);
  for (let i = index - 1; i >= 0; i--) {
    const before = seq.filter((item) => item.groupId === ordered[i].id);
    if (before.length > 0) return before[before.length - 1].id;
  }
  return index < 0 && seq.length > 0 ? seq[seq.length - 1].id : null;
}

/**
 * New `order` values for moving `id` one place up or down among its own
 * group's items (none at either end). Next to each other in the collection,
 * the two swap numbers; otherwise it is placed right before (or after) its
 * neighbour.
 */
export function moveWithinGroup(items: readonly Placed[], collection: LearnCollection, id: string, direction: 'up' | 'down'): Map<string, number> {
  const seq = sequence(items, collection);
  const item = seq.find((i) => i.id === id);
  if (!item) return new Map();
  const group = seq.filter((i) => i.groupId === item.groupId);
  const at = group.findIndex((i) => i.id === id);
  const neighbour = group[direction === 'up' ? at - 1 : at + 1];
  if (!neighbour) return new Map();
  const adjacent = Math.abs(seq.indexOf(item) - seq.indexOf(neighbour)) === 1;
  if (adjacent && item.order !== neighbour.order) {
    return new Map([
      [item.id, neighbour.order],
      [neighbour.id, item.order],
    ]);
  }
  if (direction === 'down') return placeAfter(items, collection, id, neighbour.id);
  const rest = seq.filter((i) => i.id !== id);
  const before = rest[rest.indexOf(neighbour) - 1];
  return placeAfter(items, collection, id, before ? before.id : null);
}

/** Whether an item can move up or down within its group. */
export function canMove(items: readonly Placed[], collection: LearnCollection, id: string): { up: boolean; down: boolean } {
  const seq = sequence(items, collection);
  const item = seq.find((i) => i.id === id);
  if (!item) return { up: false, down: false };
  const group = seq.filter((i) => i.groupId === item.groupId);
  const at = group.findIndex((i) => i.id === id);
  return { up: at > 0, down: at >= 0 && at < group.length - 1 };
}
