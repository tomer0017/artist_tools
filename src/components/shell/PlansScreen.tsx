import { useEffect } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { formatMoney } from '@/lib/money';
import { PlanComparison } from '@/components/plans/PlanComparison';
import { hasAllTools } from '@/lib/plans';
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
  const locale = useLocale();
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
        <p className="mt-1 text-sm text-muted-foreground md:text-base">
          {state?.account.billing?.available ? t('studio.plansLeadLive') : state && !hasAllTools(state.account.offer.free) ? t('studio.plansLeadPartial') : t('studio.plansLead')}
        </p>
        {state && (
          <div className="mt-5">
            <PlanComparison
              offer={state.account.offer}
              current={state.account.plan.effective}
              isAdmin={state.account.role === 'admin'}
              proAction={
                state.account.billing?.available && !state.account.billing.subscription?.renewing
                  ? {
                      href: '/subscribe',
                      label: t('billing.subscribe'),
                      price: state.account.billing.offer ? t('billing.perMonth', { price: formatMoney(state.account.billing.offer.amountMinor, state.account.billing.offer.currency, locale) }) : t('billing.subscribe'),
                      note: t('billing.planNote'),
                      amount: state.account.billing.offer ? formatMoney(state.account.billing.offer.amountMinor, state.account.billing.offer.currency, locale) : undefined,
                      unit: t('billing.pro.perMonthUnit'),
                      recommended: t('billing.pro.recommended'),
                    }
                  : null
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
