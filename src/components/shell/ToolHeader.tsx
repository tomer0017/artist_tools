import { Check, HelpCircle } from 'lucide-react';
import type { TabId } from '@/types/project';
import { useOnboarding, ONBOARDING } from '@/onboarding';
import { requestMeasureIntroReplay } from '@/components/measure/onboarding/useMeasureIntro';
import { requestCompareIntroReplay } from '@/features/compare-art/onboarding/useCompareIntro';
import { TOOLS } from './tools';

// ─── Shared tool chrome ───────────────────────────────────────────────────────
// Every tool opens the same way: its goal-first title, one line on what to do
// *right now*, then the workspace. Help is always one tap away but never
// pushed — the screen itself should be enough to begin.

interface ToolHeaderProps {
  tool: TabId;
  /** The current task, in plain words ("Tap two points you know the size of"). */
  task?: React.ReactNode;
  /** Tool-specific buttons (undo, save…), rendered before Help. */
  actions?: React.ReactNode;
  /** Hide Help when the tool has nothing to replay yet. */
  showHelp?: boolean;
}

export default function ToolHeader({ tool, task, actions, showHelp = true }: ToolHeaderProps) {
  const info = TOOLS[tool];
  const Icon = info.icon;
  return (
    <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-border bg-[hsl(var(--toolbar-bg))] px-3 py-1.5 md:min-h-[56px] md:px-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary" aria-hidden="true">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold leading-tight text-foreground md:text-base">{info.title}</h1>
        {task && <p className="truncate text-xs leading-snug text-muted-foreground md:text-[13px]">{task}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        {showHelp && <ToolHelpButton tool={tool} />}
      </div>
    </div>
  );
}

/** Square icon button sized for touch, matching the header's rhythm. */
export function HeaderIconButton({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:bg-secondary disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/**
 * One Help entry point for every tool. Measure and Compare replay their own
 * workflow intros; the rest replay the shared preview + spotlight tour.
 */
export function ToolHelpButton({ tool }: { tool: TabId }) {
  const { start } = useOnboarding();
  const replay =
    tool === 'measure' ? requestMeasureIntroReplay
    : tool === 'compare' ? requestCompareIntroReplay
    : ONBOARDING[tool] ? () => start(tool)
    : null;
  if (!replay) return null;
  return (
    <HeaderIconButton label="Show tutorial" onClick={replay}>
      <HelpCircle className="h-5 w-5" />
    </HeaderIconButton>
  );
}

/**
 * A compact numbered progress row ("1 Set scale — 2 Measure"). Completed steps
 * show a check; steps the artist may revisit are buttons.
 */
export function StepIndicator({ steps, current, onSelect, canSelect, trailing }: {
  steps: string[];
  current: number;
  onSelect?: (index: number) => void;
  /** Which steps are reachable; defaults to "any step up to the current one". */
  canSelect?: (index: number) => boolean;
  /** An action at the end of the row (e.g. "Change" next to a set scale). */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-[hsl(var(--toolbar-bg))] px-3 pb-2 pt-1 md:px-4">
    <ol aria-label="Progress" className="flex max-w-2xl items-center gap-1.5">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = onSelect && (canSelect ? canSelect(i) : i <= current) && !active;
        const content = (
          <>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                active ? 'bg-primary text-primary-foreground'
                : done ? 'bg-emerald-500/90 text-white'
                : 'bg-secondary text-muted-foreground'
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            {/* With more than two steps, phones show only the current
                step's name — numbers and checks carry the rest. */}
            <span className={`truncate text-xs font-medium ${active ? 'text-foreground' : 'text-muted-foreground'} ${
              !active && steps.length > 2 ? 'sr-only sm:not-sr-only' : ''
            }`}>{label}</span>
          </>
        );
        return (
          <li key={label} className={`flex min-w-0 items-center gap-1.5 ${active || steps.length <= 2 ? 'flex-1' : 'flex-none sm:flex-1'} ${i < steps.length - 1 && !active ? 'flex-1' : ''}`} aria-current={active ? 'step' : undefined}>
            {reachable ? (
              <button onClick={() => onSelect!(i)} className="flex min-h-[32px] min-w-0 items-center gap-1.5 rounded-md pr-1 hover:bg-secondary/60">
                {content}
              </button>
            ) : (
              <span className="flex min-h-[32px] min-w-0 items-center gap-1.5">{content}</span>
            )}
            {i < steps.length - 1 && <span className={`h-px min-w-[8px] flex-1 ${done ? 'bg-emerald-500/60' : 'bg-border'}`} aria-hidden="true" />}
          </li>
        );
      })}
      {trailing && <li className="shrink-0">{trailing}</li>}
    </ol>
    </div>
  );
}
