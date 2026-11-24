import { useEffect, useSyncExternalStore } from 'react';

// ─── Exactly one Sketchy on screen ────────────────────────────────────────────
// Everything that can show him (the stage on Home and Learn, the challenge
// roulette, a celebration in the corner) asks for him here while it wants
// him. Only the claim with the highest priority shows him; the others draw
// nothing at all (no canvas, no animation loop, no timers of his) until it is
// theirs again. The stage is the floor; a modal of his own (the roulette)
// takes him over while it is open and gives him back when it closes.

export const PRIORITY = { stage: 0, celebration: 50, roulette: 100 } as const;

const claims = new Map<string, number>();
/** The latest claim of each id (a release only ends its own claim). */
const owners = new Map<string, symbol>();
const listeners = new Set<() => void>();
let top: string | null = null;

function settle() {
  let best: string | null = null;
  let level = -Infinity;
  for (const [id, priority] of claims) {
    // Ties: the earlier claim keeps him.
    if (priority > level) {
      level = priority;
      best = id;
    }
  }
  if (best === top) return;
  top = best;
  for (const listener of listeners) listener();
}

/** Ask to show him; returns the release. Releasing a claim never takes him from a newer one with the same id. */
export function claimSketchy(id: string, priority: number): () => void {
  const token = Symbol(id);
  claims.delete(id);
  claims.set(id, priority);
  owners.set(id, token);
  settle();
  return () => {
    if (owners.get(id) !== token) return;
    owners.delete(id);
    claims.delete(id);
    settle();
  };
}

/** Who shows him now (null: nobody wants him). */
export const sketchyOwner = () => top;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Claim him while `wanted`; true while this claim is the one that shows him. */
export function useSketchyPresence(id: string, priority: number, wanted = true): boolean {
  useEffect(() => (wanted ? claimSketchy(id, priority) : undefined), [id, priority, wanted]);
  const owner = useSyncExternalStore(subscribe, sketchyOwner, () => null);
  return wanted && owner === id;
}
