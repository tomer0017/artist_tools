import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { hasSeenOnboarding, markOnboardingSeen } from '@/onboarding';

// Persisted through the shared onboarding storage (same prefix + reset path as
// every other tool) so the redesigned Measure intro auto-plays once and can be
// cleared with resetOnboarding('measure-intro').
export const MEASURE_INTRO_ID = 'measure-intro';

// The Header's Help button lives outside the Measure workspace, so it asks the
// (mobile or desktop) Measure surface to replay the intro through a lightweight
// window event instead of a shared provider — decoupled and device-agnostic.
const REPLAY_EVENT = 'studio:measure-intro-replay';

export function requestMeasureIntroReplay() {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT));
}

/**
 * Owns the once-ever Step-1 intro modal for whichever Measure surface mounts it
 * (mobile or desktop — never both at once). Auto-opens the first time the tool
 * has an image but no scale yet, and re-opens on demand when Help is tapped.
 */
export function useMeasureIntro() {
  const { image, calibration } = useProject();
  const [open, setOpen] = useState(false);
  const autoShown = useRef(false);

  // First-time auto-show: image loaded, no scale, never seen.
  useEffect(() => {
    if (autoShown.current) return;
    if (!image || calibration) return;
    if (hasSeenOnboarding(MEASURE_INTRO_ID)) return;
    autoShown.current = true;
    setOpen(true);
  }, [image, calibration]);

  // Replay from the Help button (ignores the "seen" flag).
  useEffect(() => {
    const replay = () => setOpen(true);
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, []);

  // Open on demand — e.g. the painter taps "Set measurement scale" before any
  // scale exists and we re-teach the step.
  const openIntro = useCallback(() => setOpen(true), []);

  // Any dismissal (start drawing OR skip) marks it seen so it never nags again.
  const close = useCallback(() => {
    markOnboardingSeen(MEASURE_INTRO_ID);
    setOpen(false);
  }, []);

  return { open, openIntro, close };
}

/**
 * Detects the moment a scale is first created (calibration goes from empty to
 * set) so the Step-3 success card can celebrate it. Works for both surfaces
 * because they share the same project store. A `sizeLabel` is returned for a
 * concrete confirmation ("Scale set — 80 cm").
 */
export function useScaleSuccess() {
  const { calibration } = useProject();
  const prev = useRef(calibration);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!prev.current && calibration) setOpen(true);
    prev.current = calibration;
  }, [calibration]);

  const dismiss = useCallback(() => setOpen(false), []);
  const sizeLabel = calibration ? `${calibration.realWorldSize} ${calibration.unit}` : undefined;

  return { open, sizeLabel, dismiss };
}
