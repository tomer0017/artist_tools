import { HelpCircle } from 'lucide-react';
import { requestCompareIntroReplay } from './useCompareIntro';

/**
 * Replay entry point for Compare Art. Like Measure, Compare uses its own
 * workflow-driven onboarding rather than the generic tour, so it has a dedicated
 * Help button that re-opens the visual intro. Styled to match HelpButton.
 */
export default function CompareHelpButton({ className = '' }: { className?: string }) {
  return (
    <button
      onClick={requestCompareIntroReplay}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
      aria-label="Show tutorial"
      title="Show tutorial"
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  );
}
