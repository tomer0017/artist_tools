import { useCallback, useMemo, useState } from 'react';
import { OnboardingContext, type OnboardingApi, type OnboardingPhase } from './onboardingContext';
import type { ToolId } from './onboardingTypes';
import { ONBOARDING } from './onboardingConfig';
import { markOnboardingSeen } from './onboardingStorage';
import OnboardingOverlay from './OnboardingOverlay';

/**
 * Owns onboarding open/step state and renders the shared overlay. Deliberately
 * decoupled from app state — the auto-start trigger lives in OnboardingHost so
 * this provider stays generic and easy to reason about.
 */
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [toolId, setToolId] = useState<ToolId | null>(null);
  const [phase, setPhase] = useState<OnboardingPhase | null>(null);
  const [step, setStep] = useState(0);

  const close = useCallback(() => {
    setToolId((cur) => {
      if (cur) markOnboardingSeen(cur);
      return null;
    });
    setPhase(null);
    setStep(0);
  }, []);

  const start = useCallback((id: ToolId) => {
    const config = ONBOARDING[id];
    if (!config) return;
    setToolId(id);
    setStep(0);
    // Value before controls: open on the preview, unless a tool skips it.
    setPhase(config.preview.length ? 'preview' : 'tour');
  }, []);

  const beginTour = useCallback(() => {
    setStep(0);
    setPhase('tour');
  }, []);

  const next = useCallback(() => {
    if (!toolId) return;
    const total = ONBOARDING[toolId]?.steps.length ?? 0;
    if (step + 1 >= total) close();
    else setStep(step + 1);
  }, [toolId, step, close]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const api = useMemo<OnboardingApi>(
    () => ({
      toolId,
      phase,
      step,
      isOpen: toolId !== null && phase !== null,
      start,
      beginTour,
      next,
      prev,
      close,
    }),
    [toolId, phase, step, start, beginTour, next, prev, close],
  );

  return (
    <OnboardingContext.Provider value={api}>
      {children}
      <OnboardingOverlay />
    </OnboardingContext.Provider>
  );
}
