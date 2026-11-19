import { useSyncExternalStore } from 'react';
import type { Localized } from '@/lib/learn/model';

// ─── "Back to the lesson" (ADR-0019) ──────────────────────────────────────────
// A tool opened from a lesson or a challenge (src/components/learn/handoff.tsx)
// remembers where it came from, so the tool shows a small way back
// (src/components/learn/ReturnBar.tsx). In memory only: it ends when the
// person leaves the tools (for Home or Learn), takes the way back, dismisses
// it, or reloads.

export interface LearnReturn {
  /** The lesson's or challenge's address in Learn. */
  href: string;
  kind: 'exercise' | 'challenge';
  /** A lesson's number in the course (none for the optional baseline or a challenge). */
  number: number | null;
  title: Localized;
}

let current: LearnReturn | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function setLearnReturn(next: LearnReturn): void {
  current = next;
  emit();
}

export function clearLearnReturn(): void {
  if (!current) return;
  current = null;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Where the tools on screen were opened from, if from Learn. */
export function useLearnReturn(): LearnReturn | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
