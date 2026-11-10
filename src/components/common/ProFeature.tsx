import Link from 'next/link';
import { Crown, X } from 'lucide-react';
import { pathForView } from '@/components/shell/tools';
import { PRO_FEATURE_INFO, type FeatureId } from '@/lib/plans';

// How the studio presents a Pro-only option to an account without it: the
// option stays visible with a lock, and choosing it explains what it does and
// why it is part of Pro, instead of doing nothing. Pro cannot be bought yet,
// and the notice says so; it links to the plan comparison, never to a payment.
// The notice is opaque: it often sits in a translucent sheet over the canvas.

/** Shown when someone picks a Pro option their plan does not include (or the server refuses one). */
export function ProNotice({ feature, onClose }: { feature: FeatureId | null; onClose?: () => void }) {
  const info = feature ? PRO_FEATURE_INFO[feature] : undefined;
  return (
    <div role="status" className="rounded-xl border border-primary/40 bg-card p-3.5 shadow-lg">
      <div className="flex items-start gap-3">
        <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          <p className="text-sm font-semibold text-foreground">{info ? `${info.name} are part of Pro` : 'This option is part of Pro'}</p>
          {info && <p className="mt-1 text-foreground/90">{info.what}</p>}
          <p className="mt-1 text-muted-foreground">{info ? info.why : 'Your plan does not include it.'}</p>
          <p className="mt-1 text-muted-foreground">Pro is coming soon and cannot be bought yet. Everything else here stays free.</p>
          <Link href={pathForView('plans')} className="mt-1.5 inline-block font-semibold text-primary underline-offset-2 hover:underline">
            Compare plans
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
    </div>
  );
}
