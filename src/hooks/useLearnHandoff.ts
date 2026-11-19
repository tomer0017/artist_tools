import { useEffect, useRef } from 'react';

// ─── A Learn reference on its way into a tool (ADR-0018) ──────────────────────
// "Open in Study & Simplify" / "Open in Compare & Correct" on an exercise or a
// challenge: the picture (a data URL, on this device only) and the item's ID
// wait here until that tool opens and takes them. Kept apart from the tools'
// own state (Compare & Correct shares nothing with the project store), and in
// memory only: a reload forgets a hand-off no tool took.

export interface LearnHandoff {
  tool: 'value' | 'compare';
  /** The picture as a data URL. */
  image: string;
  learnItem: string;
}

let pending: (LearnHandoff & { id: number }) | null = null;
const listeners = new Set<() => void>();

/** Hand a Learn reference to a tool; it takes it when it opens (or at once, if it is open). */
export function handOff(next: LearnHandoff): void {
  pending = { ...next, id: Date.now() + Math.random() };
  for (const listener of listeners) listener();
}

/** The waiting hand-off for this tool, taken (nobody else gets it). */
export function takeHandoff(tool: LearnHandoff['tool']): LearnHandoff | null {
  if (pending?.tool !== tool) return null;
  const { id: _id, ...handoff } = pending;
  pending = null;
  return handoff;
}

/** In a tool: take a hand-off meant for it, now and whenever one arrives. */
export function useLearnHandoff(tool: LearnHandoff['tool'], take: (handoff: LearnHandoff) => void): void {
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    const check = () => {
      const handoff = takeHandoff(tool);
      if (handoff) latest.current(handoff);
    };
    check();
    listeners.add(check);
    return () => {
      listeners.delete(check);
    };
  }, [tool]);
}
