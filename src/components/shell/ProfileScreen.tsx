import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Crown, Lock, LogOut, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { FEATURE_MATRIX, PLAN_NAMES } from '@/lib/plans';
import { AccountAvatar, useAccount, useSignOut, type StudioAccount } from './account';
import { BrandMark } from './BrandMark';
import { pathForView } from './tools';

// ─── Account page (/app/profile) ──────────────────────────────────────────────
// Who is signed in, which plan they are on and what it includes. Everything
// shown comes from the server; there is nothing to edit here except signing
// out. Paid plans do not exist yet, and the page says so plainly.

const SUBSCRIPTION_LABELS: Record<StudioAccount['subscription']['status'], string> = {
  none: 'None',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  expired: 'Expired',
};

const longDate = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(iso));

function planSummary(account: StudioAccount): string {
  if (account.access === 'admin') return 'As an administrator you have every feature, whatever your plan.';
  if (account.plan.effective === 'pro') {
    return account.plan.assigned === 'pro'
      ? 'Pro was given to this account by an administrator. No payment is involved.'
      : 'Pro, through your subscription.';
  }
  return 'All five tools, with no time limit.';
}

export default function ProfileScreen() {
  const state = useAccount();
  const { signingOut, signOut } = useSignOut();
  const isMobile = useIsMobile();
  const refresh = state?.refresh;
  const [introsReset, setIntrosReset] = useState<null | 'done' | 'failed'>(null);

  // Always show the account as it is now (an admin may have just changed it).
  useEffect(() => {
    void refresh?.();
  }, [refresh]);

  if (!state) return null;
  const { account } = state;
  const isAdmin = account.role === 'admin';
  const plan = account.plan.effective;
  const included = new Set(account.features);
  const subscription = account.subscription.status;

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-3 md:px-6 md:pt-8">
        {isMobile && (
          <div className="mb-5">
            <BrandMark />
          </div>
        )}
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-foreground md:text-3xl">Your account</h1>

        {/* Who */}
        <section aria-label="Profile" className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex items-center gap-4">
            <AccountAvatar account={account} size={56} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold text-foreground">{account.name}</p>
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                <span className="truncate">{account.email}</span>
                {account.emailVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified by Google" />}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${plan === 'pro' ? 'bg-primary text-primary-foreground' : 'border border-border bg-secondary/60 text-foreground'}`}>
                  {plan === 'pro' && <Crown className="h-3 w-3" aria-hidden="true" />}
                  {PLAN_NAMES[plan]}
                </span>
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Admin
                  </span>
                )}
              </div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <Detail label="Signed in with" value="Google" />
            <Detail label="Email" value={account.emailVerified ? 'Verified by Google' : 'Not verified'} />
            <Detail label="Member since" value={longDate(account.createdAt)} />
            <Detail label="Role" value={isAdmin ? 'Administrator' : 'Member'} />
          </dl>
        </section>

        {/* Plan */}
        <section aria-label="Plan" className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Current plan</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{PLAN_NAMES[plan]}</p>
              <p className="mt-1 text-sm text-muted-foreground">{planSummary(account)}</p>
            </div>
            {plan === 'pro' ? <Crown className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /> : <Sparkles className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </div>
          <dl className="mt-3 text-sm">
            <Detail label="Subscription" value={subscription === 'none' ? 'None (billing is not live yet)' : SUBSCRIPTION_LABELS[subscription]} />
          </dl>

          <ul aria-label="What your plan includes" className="mt-4 divide-y divide-border border-t border-border">
            {FEATURE_MATRIX.map((row) => {
              const has = row.features.every((f) => included.has(f));
              return (
                <li key={row.label} className="flex items-start gap-3 py-2.5">
                  {has ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Included" />
                  ) : (
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not included" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${has ? 'text-foreground' : 'text-muted-foreground'}`}>{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.detail}</p>
                  </div>
                  {!has && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Pro</span>}
                </li>
              );
            })}
          </ul>

          {!isAdmin && plan === 'free' && (
            <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="font-semibold text-foreground">Upgrade to Pro</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Large GIFs and Compare + Difference animations. Paid plans are not available yet: Pro is coming soon.
              </p>
              <button
                type="button"
                disabled
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground opacity-60 sm:w-auto sm:px-6"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> Upgrade: coming soon
              </button>
            </div>
          )}
          <Link
            href={pathForView('plans')}
            className="mt-4 inline-flex items-center text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            Compare plans
          </Link>
        </section>

        {/* Tool introductions */}
        <section aria-label="Tool introductions" className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
          <p className="font-semibold text-foreground">Tool introductions</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Each tool explains itself the first time you open it. Want to see those introductions again?
          </p>
          <button
            type="button"
            onClick={async () => setIntrosReset((await state.resetIntros()) ? 'done' : 'failed')}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 text-sm font-semibold text-foreground hover:bg-secondary sm:w-auto sm:px-6"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Show introductions again
          </button>
          {introsReset && (
            <p role="status" className={`mt-2 text-xs ${introsReset === 'done' ? 'text-primary' : 'text-destructive'}`}>
              {introsReset === 'done' ? 'Done. Each tool will introduce itself the next time you open it.' : 'That did not work. Check your connection and try again.'}
            </p>
          )}
        </section>

        {isAdmin && (
          <section aria-label="Administration" className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
            <p className="font-semibold text-foreground">Administration</p>
            <p className="mt-1 text-sm text-muted-foreground">See registered accounts, their plans and activity, and change plans for testing.</p>
            <Link
              href="/admin"
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 text-sm font-semibold text-foreground hover:bg-secondary sm:w-auto sm:px-6"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Open the admin dashboard
            </Link>
          </section>
        )}

        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-[15px] font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        <p className="mt-3 px-2 text-center text-xs text-muted-foreground">
          Your images never leave this device. From Google, Studio Companion keeps only your name, email address and picture.
        </p>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground sm:mt-0.5 sm:text-left">{value}</dd>
    </div>
  );
}
