import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { PlanComparison } from '@/components/plans/PlanComparison';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAccount } from './account';
import { BrandMark } from './BrandMark';

// ─── Plans inside the studio (/app/plans) ─────────────────────────────────────
// The same comparison as the public /pricing page, shown as a studio view so
// opening it from a tool (e.g. a locked Pro option) keeps that tool's work
// alive behind it.

export default function PlansScreen() {
  const state = useAccount();
  const isMobile = useIsMobile();
  const t = useTranslations();
  const refresh = state?.refresh;

  // Show the plan as it is now (an admin may have just changed it).
  useEffect(() => {
    void refresh?.();
  }, [refresh]);

  return (
    // Focusable, so the page can be scrolled with the keyboard (it has no links of its own).
    <div
      role="region"
      aria-labelledby="plans-screen-title"
      tabIndex={0}
      className="flex-1 overflow-y-auto overscroll-contain bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="mx-auto w-full max-w-4xl px-4 pb-10 pt-3 md:px-6 md:pt-8">
        {isMobile && (
          <div className="mb-5">
            <BrandMark />
          </div>
        )}
        <h1 id="plans-screen-title" className="text-[26px] font-bold leading-tight tracking-tight text-foreground md:text-3xl">
          {t('plans.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground md:text-base">{t('studio.plansLead')}</p>
        <div className="mt-5">
          <PlanComparison current={state?.account.plan.effective ?? null} isAdmin={state?.account.role === 'admin'} />
        </div>
      </div>
    </div>
  );
}
