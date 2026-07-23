// Completion state for the guided onboarding. Stored locally, one key per tool,
// so a tour auto-plays only once and can always be replayed on demand. Every
// access is guarded — private-browsing quota or disabled storage must never
// break the app (mirrors the rest of the codebase's localStorage handling).

const PREFIX = 'studio-onboarding-';

export function hasSeenOnboarding(id: string): boolean {
  try {
    return localStorage.getItem(PREFIX + id) === 'done';
  } catch (error) {
    // Storage unavailable (e.g. private mode): treat as "not seen" but never throw.
    console.warn('[onboarding] Could not read completion state:', error);
    return false;
  }
}

export function markOnboardingSeen(id: string): void {
  try {
    localStorage.setItem(PREFIX + id, 'done');
  } catch (error) {
    console.warn('[onboarding] Could not persist completion state:', error);
  }
}

export function resetOnboarding(id: string): void {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch (error) {
    console.warn('[onboarding] Could not reset completion state:', error);
  }
}
