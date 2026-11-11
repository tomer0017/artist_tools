import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Crown, Lock, LogOut, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { DataCard, DevicesCard, NameEditor, PreferencesCard, SignInMethodsCard } from '@/components/account/ProfileSections';
import { useIsMobile } from '@/hooks/use-mobile';
import { FEATURE_MATRIX, type FeatureId } from '@/lib/plans';
import { AccountAvatar, useAccount, useSignOut, type StudioAccount } from './account';
import { BrandMark } from './BrandMark';
import { pathForView } from './tools';

// ─── Account page (/app/profile) ──────────────────────────────────────────────
// Who is signed in, which plan they are on and what it includes, and the
// person's own controls: name and photo, language, currency and marketing
// email, sign-in methods, signed-in devices, downloading their data and
// deleting the account (src/components/account/). Everything shown comes from
// the server, and every change goes through a server action for the signed-in
// account only. Paid plans do not exist yet, and the page says so plainly.

type T = ReturnType<typeof useTranslations<'account'>>;

function planSummary(account: StudioAccount, t: T, longDate: (iso: string) => string): string {
  if (account.access === 'admin') return t('plan.summaryAdmin');
  if (account.plan.effective === 'pro') {
    if (account.plan.assigned === 'pro') return t('plan.summaryAssigned');
    if (account.grant?.planId === 'pro') return t('plan.summaryGrant', { date: longDate(account.grant.endsAt) });
    return t('plan.summarySubscription');
  }
  return t('plan.summaryFree');
}

/** A feature's name in the page language (usage limits). */
function useFeatureLabel() {
  const t = useTranslations();
  return (feature: FeatureId): string => {
    switch (feature) {
      case 'tool.measure':
        return t('tools.measure.title');
      case 'tool.study':
        return t('tools.value.title');
      case 'tool.color':
        return t('tools.color.title');
      case 'tool.grid':
        return t('tools.grid.title');
      case 'tool.compare':
        return t('tools.compare.title');
      case 'export.image':
        return t('account.features.exportImage');
      case 'export.gif':
        return t('account.features.exportGif');
      case 'export.gif_large':
        return t('account.features.exportGifLarge');
      case 'export.gif_difference':
        return t('account.features.exportGifDifference');
    }
  };
}

export default function ProfileScreen() {
  const t = useTranslations('account');
  const tg = useTranslations();
  const locale = useLocale();
  const featureLabel = useFeatureLabel();
  const longDate = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso));
  const state = useAccount();
  const { signingOut, signOut } = useSignOut();
  const isMobile = useIsMobile();
  const refresh = state?.refresh;
  const [introsReset, setIntrosReset] = useState<null | 'done' | 'failed'>(null);

  const [returned, setReturned] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Always show the account as it is now (an admin may have just changed it).
  useEffect(() => {
    void refresh?.();
  }, [refresh]);

  // Coming back from Google (connecting it, or confirming who you are).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.has('connect_error')
      ? { tone: 'error' as const, text: t('returned.connectError') }
      : params.get('connected') === 'google'
        ? { tone: 'ok' as const, text: t('returned.connected') }
        : params.has('confirmed')
          ? { tone: 'ok' as const, text: t('returned.confirmed') }
          : null;
    if (!message) return;
    setReturned(message);
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  if (!state) return null;
  const { account } = state;
  const isAdmin = account.role === 'admin';
  const plan = account.plan.effective;
  const included = new Set(account.features);
  const subscription = account.subscription.status;
  const planName = plan === 'pro' ? tg('plans.pro') : tg('plans.free');

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-3 md:px-6 md:pt-8">
        {isMobile && (
          <div className="mb-5">
            <BrandMark />
          </div>
        )}
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-foreground md:text-3xl">{t('title')}</h1>
        {returned && (
          <p role={returned.tone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg border px-3 py-2 text-sm text-foreground ${returned.tone === 'error' ? 'border-destructive/40 bg-destructive/10' : 'border-primary/40 bg-primary/10'}`}>
            {returned.text}
          </p>
        )}

        {/* Who */}
        <section aria-label={t('profile')} className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex items-center gap-4">
            <AccountAvatar account={account} size={56} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-foreground">{account.name}</p>
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <span className="truncate">{account.email}</span>
                {account.emailVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label={t('verified')} />}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${plan === 'pro' ? 'bg-primary text-primary-foreground' : 'border border-border bg-secondary/60 text-foreground'}`}>
                  {plan === 'pro' && <Crown className="h-3 w-3" aria-hidden="true" />}
                  {planName}
                </span>
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {t('admin')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <Detail label={t('signedInWith')} value={signInWith(account, t)} />
            <Detail label={t('email')} value={account.emailVerified ? (account.methods.google ? t('verifiedByGoogle') : t('verified')) : t('notVerified')} />
            <Detail label={t('memberSince')} value={longDate(account.createdAt)} />
            <Detail label={t('role')} value={isAdmin ? t('administrator') : t('member')} />
          </dl>
          <NameEditor account={account} onChanged={state.refresh} />
        </section>

        {/* Plan */}
        <section aria-label={t('plan.section')} className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('plan.current')}</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{planName}</p>
              <p className="mt-1 text-sm text-muted-foreground">{planSummary(account, t, longDate)}</p>
            </div>
            {plan === 'pro' ? <Crown className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /> : <Sparkles className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </div>
          <dl className="mt-3 text-sm">
            <Detail label={t('plan.subscription')} value={subscription === 'none' ? t('plan.subscriptionNone') : t(`plan.status.${subscription}`)} />
          </dl>
          {account.quotas.length > 0 && (
            <ul aria-label={t('plan.usageLimits')} className="mt-3 space-y-1 text-sm">
              {account.quotas.map((q) => (
                <li key={`${q.feature}-${q.period}`} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{featureLabel(q.feature)}</span>
                  <span className="font-medium text-foreground">
                    {t(q.period === 'day' ? 'plan.quotaDay' : 'plan.quotaMonth', { left: q.left, limit: q.limit })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <ul aria-label={t('plan.includes')} className="mt-4 divide-y divide-border border-t border-border">
            {FEATURE_MATRIX.map((row) => {
              const has = row.features.every((f) => included.has(f));
              return (
                <li key={row.id} className="flex items-start gap-3 py-2.5">
                  {has ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label={tg('plans.included')} />
                  ) : (
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={tg('plans.notIncluded')} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${has ? 'text-foreground' : 'text-muted-foreground'}`}>{tg(`plans.rows.${row.id}.label`)}</p>
                    <p className="text-xs text-muted-foreground">{tg(`plans.rows.${row.id}.detail`)}</p>
                  </div>
                  {!has && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Pro</span>}
                </li>
              );
            })}
          </ul>

          {!isAdmin && plan === 'free' && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="font-semibold text-foreground">{t('plan.upgradeTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('plan.upgradeLead')}</p>
              <button
                type="button"
                disabled
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground opacity-60 sm:w-auto sm:px-6"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {t('plan.upgradeSoon')}
              </button>
            </div>
          )}
          <Link
            href={pathForView('plans')}
            className="mt-4 inline-flex items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {tg('common.comparePlans')}
          </Link>
        </section>

        <PreferencesCard account={account} onChanged={state.refresh} />
        <SignInMethodsCard account={account} onChanged={state.refresh} />
        <DevicesCard />

        {/* Tool introductions */}
        <section aria-label={t('intros.title')} className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
          <p className="font-semibold text-foreground">{t('intros.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('intros.lead')}</p>
          <button
            type="button"
            onClick={async () => setIntrosReset((await state.resetIntros()) ? 'done' : 'failed')}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 text-sm font-semibold text-foreground hover:bg-secondary sm:w-auto sm:px-6"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> {t('intros.reset')}
          </button>
          {introsReset && (
            <p role="status" className={`mt-2 text-xs ${introsReset === 'done' ? 'text-primary' : 'text-destructive'}`}>
              {introsReset === 'done' ? t('intros.done') : t('intros.failed')}
            </p>
          )}
        </section>

        {isAdmin && (
          <section aria-label={t('adminSection.title')} className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
            <p className="font-semibold text-foreground">{t('adminSection.title')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('adminSection.lead')}</p>
            <Link
              href="/admin"
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 text-sm font-semibold text-foreground hover:bg-secondary sm:w-auto sm:px-6"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t('adminSection.open')}
            </Link>
          </section>
        )}

        <DataCard account={account} />

        <button
          type="button"
          onClick={() => signOut()}
          disabled={signingOut}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-[15px] font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> {signingOut ? tg('studio.signingOut') : tg('studio.signOut')}
        </button>
        <button
          type="button"
          onClick={() => signOut({ clearDevice: true })}
          disabled={signingOut}
          className="mx-auto mt-2 block rounded-md px-2 py-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {t('sharedDevice')}
        </button>
        <p className="mt-3 px-2 text-center text-xs text-muted-foreground">{t('privacy')}</p>
      </div>
    </div>
  );
}

function signInWith(account: StudioAccount, t: T): string {
  const { google, password } = account.methods;
  if (google && password) return t('methodBoth');
  return password ? t('methodPassword') : t('methodGoogle');
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium text-foreground sm:mt-0.5 sm:text-start">{value}</dd>
    </div>
  );
}
