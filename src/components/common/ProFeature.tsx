import Link from 'next/link';
import { Crown, X } from 'lucide-react';
import { pathForView } from '@/components/shell/tools';
import { useTranslations } from 'use-intl';
import type { FeatureId } from '@/lib/plans';

// How the studio presents a Pro-only option to an account without it: the
// option stays visible with a lock, and choosing it explains what it does and
// why it is part of Pro, instead of doing nothing. Pro cannot be bought yet,
// and the notice says so; it links to the plan comparison, never to a payment.
// The notice is opaque: it often sits in a translucent sheet over the canvas.

/** Shown when someone picks a Pro option their plan does not include (or the server refuses one). */
export function ProNotice({ feature, onClose }: { feature: FeatureId | null; onClose?: () => void }) {
  const t = useTranslations('toolsCommon.pro');
  const key = feature === 'export.gif_large' ? 'large' : feature === 'export.gif_difference' ? 'difference' : null;
  return (
    <div role="status" className="rounded-xl border border-primary/40 bg-card p-3.5 shadow-lg">
      <div className="flex items-start gap-3">
        <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          <p className="text-sm font-semibold text-foreground">{key ? t('partOfPro', { name: t(`${key}.name`) }) : t('optionPartOfPro')}</p>
          {key && <p className="mt-1 text-foreground/90">{t(`${key}.what`)}</p>}
          <p className="mt-1 text-muted-foreground">{key ? t(`${key}.why`) : t('notIncluded')}</p>
          <p className="mt-1 text-muted-foreground">{t('comingSoon')}</p>
          <Link href={pathForView('plans')} className="mt-1.5 inline-block font-semibold text-primary underline-offset-2 hover:underline">
            {t('comparePlans')}
          </Link>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dismiss')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
