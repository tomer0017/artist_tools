import { createContext, useContext } from 'react';
import type { ToolId } from './onboardingTypes';

export type OnboardingPhase = 'preview' | 'tour';

// Imperative surface shared by the launcher (Help button), the auto-start host
// and the overlay. Kept in its own module so the fast-refresh boundary stays
// clean (only hooks/values here, no components).
export interface OnboardingApi {
  toolId: ToolId | null;
  phase: OnboardingPhase | null;
  step: number;
  isOpen: boolean;
  /** Open a tool's onboarding, starting at its preview (or tour if none). */
  start: (id: ToolId) => void;
  /** Advance from the preview into the guided tour. */
  beginTour: () => void;
  next: () => void;
  prev: () => void;
  /** Close and mark the current tool's onboarding as seen. */
  close: () => void;
}

export const OnboardingContext = createContext<OnboardingApi | null>(null);

export function useOnboarding(): OnboardingApi {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within an OnboardingProvider');
  return ctx;
}
