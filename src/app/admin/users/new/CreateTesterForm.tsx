'use client';

import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { PLAN_NAMES, type PlanId } from '@/lib/plans';
import { USERNAME_MAX_LENGTH, usernameProblem } from '@/lib/username';
import { createTester, type PasswordResult } from '../../actions';
import { OneTimePassword } from '../../AdminControls';

// A tester's account: a username and a generated password, which the admin
// sees once and hands over. The server decides everything again (see
// ../../actions.ts); this form only asks and reports.

const HINTS = {
  too_short: 'At least 3 characters.',
  too_long: `At most ${USERNAME_MAX_LENGTH} characters.`,
  invalid: 'English letters, digits, dots and underscores only.',
} as const;

const FIELD =
  'mt-1.5 block h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive md:text-sm';

export function CreateTesterForm() {
  const ids = { username: useId(), usernameHint: useId(), name: useId(), plan: useId() };
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<PlanId>('free');
  const [locale, setLocale] = useState<'en' | 'he'>('en');
  const [test, setTest] = useState(true);
  const [result, setResult] = useState<PasswordResult | null>(null);
  const [pending, startTransition] = useTransition();
  const problem = username.trim() ? usernameProblem(username.trim()) : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || problem) return;
    startTransition(async () => setResult(await createTester({ username: username.trim(), name: name.trim() || undefined, plan, locale, test })));
  }

  function another() {
    setResult(null);
    setUsername('');
    setName('');
    setPlan('free');
  }

  if (result?.ok && result.credentials) {
    const { credentials } = result;
    return (
      <div className="mt-5 max-w-xl">
        <p role="status" className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {result.message} Role User, plan {PLAN_NAMES[plan]}, active.
        </p>
        <OneTimePassword credentials={credentials} onDone={another} />
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href={`/admin/users/${credentials.userId}`} className="rounded-lg border border-border px-3 py-2 font-medium text-foreground hover:bg-secondary">
            Open the account
          </Link>
          <button type="button" onClick={another} className="rounded-lg border border-border px-3 py-2 font-medium text-foreground hover:bg-secondary">
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} aria-label="New tester account" className="mt-5 max-w-xl space-y-5 rounded-2xl border border-border bg-card p-4 md:p-5" noValidate>
      <div>
        <label htmlFor={ids.username} className="text-sm font-medium text-foreground">
          Username
        </label>
        <input
          id={ids.username}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={60}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          required
          aria-invalid={problem ? true : undefined}
          aria-describedby={ids.usernameHint}
          className={FIELD}
        />
        <p id={ids.usernameHint} className={`mt-1 text-xs ${problem ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
          {problem ? HINTS[problem] : '3–30 English letters, digits, dots or underscores. Signing in ignores capitals; it cannot be changed later.'}
        </p>
      </div>

      <div>
        <label htmlFor={ids.name} className="text-sm font-medium text-foreground">
          Display name <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" className={FIELD} />
        <p className="mt-1 text-xs text-muted-foreground">Shown in the studio. The username when left empty; they can change it themselves.</p>
      </div>

      <fieldset>
        <legend id={ids.plan} className="text-sm font-medium text-foreground">
          Plan
        </legend>
        <div role="group" aria-labelledby={ids.plan} className="mt-1.5 flex gap-1 rounded-lg bg-secondary/60 p-1">
          {(['free', 'pro'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={plan === p}
              onClick={() => setPlan(p)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                plan === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {PLAN_NAMES[p]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">No payment is involved; you can change it later. The role is always User: Pro never gives admin access.</p>
      </fieldset>

      <label className="block text-sm font-medium text-foreground">
        Language
        <select value={locale} onChange={(e) => setLocale(e.target.value === 'he' ? 'he' : 'en')} className={FIELD}>
          <option value="en">English</option>
          <option value="he">עברית (Hebrew)</option>
        </select>
      </label>

      <label className="flex items-start gap-3 text-sm text-foreground">
        <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" />
        <span>
          <span className="font-medium">Test account</span>
          <span className="block text-xs text-muted-foreground">Left out of analytics and revenue figures.</span>
        </span>
      </label>

      {result && !result.ok && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !username.trim() || problem !== null}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 sm:w-auto"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {pending ? 'Creating…' : 'Create account'}
      </button>
      <p className="text-xs text-muted-foreground">A strong password is generated for it and shown to you once. The creation is recorded in the activity log.</p>
    </form>
  );
}
