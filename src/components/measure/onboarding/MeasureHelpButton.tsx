import { HelpCircle } from 'lucide-react';
import { requestMeasureIntroReplay } from './useMeasureIntro';

/**
 * Replay entry point for the Measure tool. The Measure onboarding is its own
 * workflow-driven experience (not the generic preview + spotlight tour), so it
 * has a dedicated Help button that simply re-opens the Step-1 intro. Styled to
 * match the generic HelpButton so the header reads consistently.
 */
export default function MeasureHelpButton({ className = '' }: { className?: string }) {
  return (
    <button
      onClick={requestMeasureIntroReplay}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
      aria-label="Show tutorial"
      title="Show tutorial"
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  );
}
