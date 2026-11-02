import type { TabId } from '@/types/project';
import { ToolArt } from './ToolArt';

// ─── First screen of an image tool ────────────────────────────────────────────
// Instead of a bare upload box: what you will get (the picture), the few steps
// to get there, then the one action that starts it.

export default function ToolEmptyState({ tool, heading, steps, children, note }: {
  tool: TabId;
  heading: string;
  /** Two or three short steps, in order. */
  steps: string[];
  /** The primary action — usually an ImageUploader. */
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto canvas-area">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5 md:max-w-lg md:py-10">
        <div className="aspect-[16/9] w-full overflow-hidden rounded-2xl border border-border bg-secondary">
          <ToolArt tool={tool} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
          <ol className="mt-2 space-y-1.5">
            {steps.map((step, i) => (
              <li key={step} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
        {children}
        {note && <p className="text-center text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}
