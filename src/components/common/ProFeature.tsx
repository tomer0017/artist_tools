import Link from 'next/link';
import { Sparkles, X } from 'lucide-react';
import { pathForView } from '@/components/shell/tools';

// How the studio presents a Pro-only option to an account without it: the
// option stays visible with a lock, and choosing it explains what it is
// instead of doing nothing. There is no way to buy Pro yet, and it says so.
// The notice is opaque: it often sits in a translucent sheet over the canvas.

/** Shown when someone picks a Pro option their plan does not include. */
export function ProNotice({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-primary/40 bg-card p-3 shadow-lg">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-muted-foreground">Upgrades are coming soon: paid plans are not available yet.</p>
        <Link href={pathForView('profile')} className="mt-1 inline-block font-medium text-primary underline-offset-2 hover:underline">
          See your plan
        </Link>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
