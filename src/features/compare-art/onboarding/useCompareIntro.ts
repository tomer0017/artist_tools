import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSeenOnboarding, markOnboardingSeen } from '@/onboarding';

// Persisted through the shared onboarding storage (same prefix + reset path as
// every other tool). resetOnboarding('compare-intro') replays it from scratch.
export const COMPARE_INTRO_ID = 'compare-intro';

// The Header's Help button lives outside the (lazy-loaded) Compare workspace, so
// it asks Compare to replay the intro through a lightweight window event.
const REPLAY_EVENT = 'studio:compare-intro-replay';

export function requestCompareIntroReplay() {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}

/**
 * Owns the once-ever Compare intro modal: auto-opens the first time the Compare
 * workspace mounts, and re-opens on demand when Help is tapped. Any dismissal
 * (start or close) marks it seen so it never nags again.
 */
export function useCompareIntro() {
  const [open, setOpen] = useState(false);
  const autoShown = useRef(false);

  useEffect(() => {
    if (autoShown.current) return;
    autoShown.current = true;
    if (!hasSeenOnboarding(COMPARE_INTRO_ID)) setOpen(true);
  }, []);

  useEffect(() => {
    const replay = () => setOpen(true);
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, []);

  const close = useCallback(() => {
    markOnboardingSeen(COMPARE_INTRO_ID);
    setOpen(false);
  }, []);

  return { open, close };
}
