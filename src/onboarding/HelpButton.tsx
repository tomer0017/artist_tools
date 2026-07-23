import { HelpCircle } from 'lucide-react';
import { useOnboarding } from './onboardingContext';
import { ONBOARDING } from './onboardingConfig';
import type { ToolId } from './onboardingTypes';

/**
 * The always-available replay entry point. Drop it in a tool's chrome (or pass
 * the active tool) and the user can re-watch the preview + tour anytime, with
 * no reset and no data loss. Renders nothing for tools without onboarding.
 */
export default function HelpButton({
  toolId,
  className = '',
}: {
  toolId: ToolId;
  className?: string;
}) {
  const { start } = useOnboarding();
  if (!ONBOARDING[toolId]) return null;

  return (
    <button
      onClick={() => start(toolId)}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
      aria-label="Show tutorial"
      title="Show tutorial"
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  );
}
