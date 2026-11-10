import Link from 'next/link';
import { Check, Clock, Crown, Minus, Sparkles } from 'lucide-react';
import { FEATURE_MATRIX, PLAN_FEATURES, PRO_FEATURES, type PlanId } from '@/lib/plans';

// ─── Plans ────────────────────────────────────────────────────────────────────
// Free and Pro side by side, from the same matrix the server enforces
// (src/lib/plans.ts). There are no prices and nothing to buy: Free is
// available now, Pro is "coming soon", and the page says so plainly. Used by
// the public /pricing page and by the studio's /app/plans view.

const proOnly = FEATURE_MATRIX.filter((row) => row.features.some((f) => PRO_FEATURES.includes(f)));
const inFree = FEATURE_MATRIX.filter((row) => row.features.every((f) => PLAN_FEATURES.free.includes(f)));

export function PlanComparison({
  current,
  isAdmin = false,
  freeAction,
  registration,
}: {
  /** The signed-in person's plan in force, or null on the public page. */
  current: PlanId | null;
  isAdmin?: boolean;
  /** Where Free's button leads (public page); none in the studio. */
  freeAction?: { href: string; label: string } | null;
  /** Shown in the questions when known: whether anyone can sign up yet. */
  registration?: 'open' | 'invite' | null;
}) {
  const questions = [
    { q: 'Is Studio Companion free?', a: 'Yes. The Free plan includes all five tools, with no time limit. All you need is a Google account.' },
    ...(registration === 'invite'
      ? [{ q: 'How do I get an account?', a: 'Studio Companion is invite-only while we test it. Once your Google account is invited, signing in creates your free account automatically.' }]
      : registration === 'open'
        ? [{ q: 'How do I get an account?', a: 'Continue with Google. If you are new, your free account is created automatically: no password, no payment.' }]
        : []),
    { q: 'What will Pro add?', a: 'Large GIFs (up to 800 px) and Compare + Difference animations, with more export options planned.' },
    { q: 'Can I buy Pro now?', a: 'Not yet. Pro is coming soon. There is no payment anywhere in Studio Companion today, and nothing is ever charged.' },
    { q: 'Are my images uploaded?', a: 'No. Every tool runs in your browser, and your images stay on your device.' },
  ];

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {/* Free */}
        <section aria-labelledby="plan-free" className="flex flex-col rounded-2xl border border-primary/50 bg-card p-5 shadow-sm md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="plan-free" className="text-xl font-semibold text-foreground">Free</h2>
              <p className="mt-1 text-sm text-muted-foreground">Everything you need to plan, study and check a painting.</p>
            </div>
            <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">Available now</span>
          </div>
          <ul className="mt-5 space-y-3" aria-label="Included in Free">
            {inFree.map((row) => (
              <li key={row.label} className="flex gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            {current === 'free' && !isAdmin ? (
              <p className="flex h-11 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-sm font-semibold text-primary">Your current plan</p>
            ) : freeAction ? (
              <Link
                href={freeAction.href}
                className="flex h-12 items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {freeAction.label}
              </Link>
            ) : null}
          </div>
        </section>

        {/* Pro */}
        <section aria-labelledby="plan-pro" className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="plan-pro" className="flex items-center gap-1.5 text-xl font-semibold text-foreground">
                <Crown className="h-5 w-5 text-primary" aria-hidden="true" /> Pro
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">For artists who share, teach and want more from their exports.</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs font-semibold text-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" /> Coming soon
            </span>
          </div>
          <p className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Everything in Free, plus</p>
          <ul className="mt-3 space-y-3" aria-label="Added in Pro">
            {proOnly.map((row) => (
              <li key={row.label} className="flex gap-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            {current === 'pro' && !isAdmin ? (
              <p className="flex h-11 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-sm font-semibold text-primary">Your current plan</p>
            ) : (
              <button
                type="button"
                disabled
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 text-[15px] font-semibold text-muted-foreground"
              >
                <Clock className="h-4 w-4" aria-hidden="true" /> Coming soon
              </button>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">Pro cannot be bought yet. Nothing is charged anywhere in Studio Companion.</p>
          </div>
        </section>
      </div>

      {isAdmin && (
        <p className="mt-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
          You are an administrator, so every feature is already open to you, whatever your plan.
        </p>
      )}

      <section aria-labelledby="plans-compare" className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <h2 id="plans-compare" className="px-4 pb-2 pt-4 text-base font-semibold text-foreground md:px-5">Compare plans</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 font-medium md:px-5">Feature</th>
              <th scope="col" className="w-16 px-2 py-2 text-center font-medium md:w-24">Free</th>
              <th scope="col" className="w-16 px-2 py-2 text-center font-medium md:w-24">Pro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {FEATURE_MATRIX.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="px-4 py-3 font-normal md:px-5">
                  <span className="block font-medium text-foreground">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                </th>
                {(['free', 'pro'] as const).map((plan) => (
                  <td key={plan} className="px-2 py-3 text-center">
                    {row.features.every((f) => PLAN_FEATURES[plan].includes(f)) ? (
                      <Check className="mx-auto h-4 w-4 text-primary" aria-label="Included" />
                    ) : (
                      <Minus className="mx-auto h-4 w-4 text-muted-foreground" aria-label="Not included" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="plans-questions" className="mt-6">
        <h2 id="plans-questions" className="text-base font-semibold text-foreground">Questions</h2>
        <dl className="mt-3 space-y-4">
          {questions.map(({ q, a }) => (
            <div key={q}>
              <dt className="text-sm font-medium text-foreground">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
