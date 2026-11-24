import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EMPTY_MEMORY, readMemory, type Memory } from '@/lib/companion/brain';
import { COMPANION_STORAGE_PREFIX, type Audience, type CompanionFeature, type CompanionSettings, type CompanionTip, type ToolId } from '@/lib/companion/model';
import { useAccount } from '@/components/shell/account';

// ─── Sketchy's state in the studio (ADR-0024) ────────────────────────────────
// What the studio tells him (a save, a completed lesson or challenge, the
// tool used last), what he remembers on this device (which tips appeared,
// the pace, a snooze), and his data from the server, asked for once and
// again only when the account's companion key changes. Everything he keeps
// in this browser starts with COMPANION_PREFIX, so "Sign out and remove the
// work stored here" removes it too (src/lib/device-data.ts).

export const COMPANION_PREFIX = COMPANION_STORAGE_PREFIX;

// ─── Events from the rest of the studio ───────────────────────────────────────

export type CompanionEvent = { type: 'saved'; tool: ToolId | null } | { type: 'completed'; itemId: string; kind: 'lesson' | 'challenge' };

const listeners = new Set<(event: CompanionEvent) => void>();
const PENDING_KEY = `${COMPANION_PREFIX}-pending`;

/** Tell Sketchy something good happened (a save, a completion). Never throws; costs nothing when he is not there. */
export function emitCompanion(event: CompanionEvent) {
  try {
    // Kept for this tab, so Home can follow it up when the person comes back.
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...event, at: Date.now() }));
  } catch {
    // Private mode: only the live listeners hear it.
  }
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A listener's failure is never the studio's.
    }
  }
}

export function useCompanionEvents(listener: (event: CompanionEvent) => void) {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}

/** The latest event of this tab, if recent (taken once: Home follows it up only once). */
export function takePending(maxAgeMs = 30 * 60_000): (CompanionEvent & { at: number }) | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    const value = JSON.parse(raw) as CompanionEvent & { at: number };
    if (typeof value?.at !== 'number' || Date.now() - value.at > maxAgeMs) return null;
    if (value.type === 'saved' || value.type === 'completed') return value;
    return null;
  } catch {
    return null;
  }
}

// ─── Whether a stage is on screen (it celebrates itself; the corner celebration stays quiet) ──

let stages = 0;
/** Count a mounted stage; returns the cleanup. */
export function stageMounted(): () => void {
  stages += 1;
  return () => {
    stages -= 1;
  };
}
export const stageOnScreen = () => stages > 0;

// ─── The tool used last in this tab ───────────────────────────────────────────

const LAST_TOOL_KEY = `${COMPANION_PREFIX}-last-tool`;
const toolListeners = new Set<() => void>();
let lastToolNow: ToolId | null | undefined;

export function noteToolUsed(tool: ToolId) {
  lastToolNow = tool;
  try {
    window.sessionStorage.setItem(LAST_TOOL_KEY, tool);
  } catch {
    // Remembered for this page only.
  }
  for (const l of toolListeners) l();
}

function readLastTool(): ToolId | null {
  if (lastToolNow !== undefined) return lastToolNow;
  try {
    const v = window.sessionStorage.getItem(LAST_TOOL_KEY);
    lastToolNow = v === 'measure' || v === 'value' || v === 'color' || v === 'grid' || v === 'compare' ? v : null;
  } catch {
    lastToolNow = null;
  }
  return lastToolNow;
}

export function useLastTool(): ToolId | null {
  return useSyncExternalStore(
    (l) => {
      toolListeners.add(l);
      return () => toolListeners.delete(l);
    },
    readLastTool,
    () => null,
  );
}

// ─── What he remembers on this device ─────────────────────────────────────────

const memoryKey = (userId: string) => `${COMPANION_PREFIX}:${userId}`;

export function loadMemory(userId: string): Memory {
  try {
    return readMemory(JSON.parse(window.localStorage.getItem(memoryKey(userId)) ?? 'null'));
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export function saveMemory(userId: string, memory: Memory) {
  try {
    window.localStorage.setItem(memoryKey(userId), JSON.stringify(memory));
  } catch {
    // Private mode or full storage: he forgets on reload, nothing else.
  }
}

// ─── His data from the server ─────────────────────────────────────────────────

export type FeatureState = 'open' | 'locked' | 'hidden';

export interface CompanionView {
  version: number | null;
  key: string;
  settings: CompanionSettings;
  features: Record<CompanionFeature, FeatureState>;
  tips: CompanionTip[];
}

/** /api/companion for this account: asked once, then only when its key changes (never on a timer). */
export function useCompanionView(enabled: boolean) {
  const key = useAccount()?.account.companion?.key ?? 'none';
  return useQuery({
    queryKey: ['companion', key],
    enabled,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<CompanionView> => {
      const response = await fetch('/api/companion', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`companion ${response.status}`);
      return (await response.json()) as CompanionView;
    },
  });
}

/** The person's own choices (hide him, who they are), saved on their account; the studio's copy follows at once. */
export function useCompanionPrefs() {
  const state = useAccount();
  const [saving, setSaving] = useState(false);
  const save = useCallback(
    async (prefs: { hidden?: boolean; audience?: Audience | null }, options: { refresh?: boolean } = {}): Promise<boolean> => {
      setSaving(true);
      try {
        const response = await fetch('/api/me/companion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(prefs),
          credentials: 'same-origin',
        });
        if (!response.ok) return false;
        if (options.refresh !== false) await state?.refresh();
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [state],
  );
  return { save, saving };
}

/** Whether the person asked for less motion (followed live). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', l);
      return () => mq.removeEventListener('change', l);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}
