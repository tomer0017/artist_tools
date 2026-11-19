// ─── Class mode (ADR-0018, S7 in docs/learn/04) ────────────────────────────────
// A setting of this browser tab, not of the account: while it is on, nothing
// is written to the account's history (the studio never calls the completion
// API) and the challenges shown are remembered only in this tab. There are no
// students anywhere: no profiles, names, photos or results. It turns itself
// off after 12 hours without use, so a teacher's own history is not silently
// skipped for days. Kept in sessionStorage, so closing the tab ends it too.

export const CLASS_MODE_KEY = 'studio-learn-class-mode';
/** Challenges shown in this tab (for Random and "Another one"), forgotten when class mode is turned off. */
export const RECENT_KEY = 'studio-learn-recent';
export const CLASS_MODE_IDLE_MS = 12 * 60 * 60 * 1000;
/** Use refreshes the idle clock at most this often. */
export const CLASS_MODE_TOUCH_MS = 60 * 1000;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface Stored {
  on: true;
  lastActive: number;
}

function read(storage: Storage): Stored | null {
  try {
    const value = JSON.parse(storage.getItem(CLASS_MODE_KEY) ?? 'null') as Partial<Stored> | null;
    return value?.on === true && typeof value.lastActive === 'number' && Number.isFinite(value.lastActive) ? { on: true, lastActive: value.lastActive } : null;
  } catch {
    return null;
  }
}

/** Whether class mode is on in this tab now; past the idle limit it turns itself off (and forgets the tab's recent challenges). */
export function classModeOn(storage: Storage, now = Date.now()): boolean {
  const stored = read(storage);
  if (!stored) return false;
  if (now - stored.lastActive > CLASS_MODE_IDLE_MS || stored.lastActive > now + CLASS_MODE_TOUCH_MS) {
    setClassMode(storage, false, now);
    return false;
  }
  return true;
}

/** Turn class mode on or off in this tab. Off also forgets the challenges shown in it. */
export function setClassMode(storage: Storage, on: boolean, now = Date.now()): void {
  try {
    if (on) storage.setItem(CLASS_MODE_KEY, JSON.stringify({ on: true, lastActive: now } satisfies Stored));
    else {
      storage.removeItem(CLASS_MODE_KEY);
      storage.removeItem(RECENT_KEY);
    }
  } catch {
    // Storage unavailable (a private window's limits): class mode simply does not stick.
  }
}

/** Use of the studio while class mode is on: restart the idle clock (at most once a minute). */
export function touchClassMode(storage: Storage, now = Date.now()): void {
  const stored = read(storage);
  if (stored && now - stored.lastActive >= CLASS_MODE_TOUCH_MS && now - stored.lastActive <= CLASS_MODE_IDLE_MS) {
    try {
      storage.setItem(CLASS_MODE_KEY, JSON.stringify({ on: true, lastActive: now } satisfies Stored));
    } catch {
      // As above.
    }
  }
}

/** The challenges shown recently in this tab, most recent first. */
export function readRecent(storage: Storage): string[] {
  try {
    const value = JSON.parse(storage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function writeRecent(storage: Storage, ids: string[]): void {
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 12)));
  } catch {
    // As above.
  }
}
