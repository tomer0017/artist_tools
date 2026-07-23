import { useEffect, useRef } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { useOnboarding } from './onboardingContext';
import { ONBOARDING } from './onboardingConfig';
import { hasSeenOnboarding } from './onboardingStorage';

/**
 * Auto-starts a tool's onboarding the first time it is opened — once, ever, per
 * tool. Renders nothing. Kept separate from the provider so the provider needs
 * no knowledge of app state.
 */
export default function OnboardingHost() {
  const { activeTab } = useProject();
  const { start, isOpen } = useOnboarding();

  // Don't re-trigger the same tool twice within a session even before the
  // "seen" flag is written (e.g. if the user tabs away before finishing).
  const triggered = useRef<Set<string>>(new Set());
  // Read the latest open-state inside the delayed callback without making it a
  // dependency (which would reset the timer whenever onboarding opens/closes).
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  useEffect(() => {
    const id = activeTab;
    if (!ONBOARDING[id]) return;
    if (hasSeenOnboarding(id)) return;
    if (triggered.current.has(id)) return;
    triggered.current.add(id);
    // Let the workspace layout settle so any spotlight targets exist first.
    const timer = window.setTimeout(() => {
      if (!openRef.current) start(id);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeTab, start]);

  return null;
}
