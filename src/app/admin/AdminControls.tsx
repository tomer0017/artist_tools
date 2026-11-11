'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ReauthPanel } from '@/components/account/parts';
import { PLAN_NAMES, type PlanId } from '@/lib/plans';
import { changePlan, changeRole, changeStatus, changeTestFlag, endAccess, giveAccess, type ActionResult } from './actions';

// What an admin can change on an account, each behind a confirmation. The
// server re-checks everything (see ./actions.ts); these controls only ask and
// report. Role and status changes need a recent sign-in: when the server asks
// for one, the control offers it in place.

/** Who is using the dashboard, for "confirm it is you". */
export interface Viewer {
  email: string;
  hasPassword: boolean;
  /** This page, to come back to after signing in again with Google. */
  returnTo: string;
}

function Reauth({ result, viewer, onConfirmed, onCancel }: { result: ActionResult | null; viewer: Viewer; onConfirmed: () => void; onCancel: () => void }) {
  if (!result?.reauth) return null;
  return <ReauthPanel email={viewer.email} hasPassword={viewer.hasPassword} returnTo={viewer.returnTo} onConfirmed={onConfirmed} onCancel={onCancel} />;
}

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`mt-2 text-xs ${result.ok ? 'text-primary' : 'text-destructive'}`}>
      {result.message}
    </p>
  );
}

export function PlanControl({ userId, plan, name }: { userId: string; plan: PlanId; name: string }) {
  const [target, setTarget] = useState<PlanId | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const confirm = () => {
    const next = target;
    if (!next) return;
    startTransition(async () => {
      setResult(await changePlan({ userId, plan: next }));
      router.refresh();
    });
  };

  return (
    <div>
      <div role="group" aria-label="Assigned plan" className="flex gap-1 rounded-lg bg-secondary/60 p-1">
        {(['free', 'pro'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={plan === p}
            disabled={pending}
            onClick={() => {
              setResult(null);
              if (p !== plan) setTarget(p);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
              plan === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {PLAN_NAMES[p]}
          </button>
        ))}
      </div>
      <Result result={result} />
      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change {name}&rsquo;s plan to {target ? PLAN_NAMES[target] : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {target === 'pro'
                ? 'For testing: no payment is taken. Pro features apply from their next request.'
                : 'They lose Pro features from their next request.'}{' '}
              The change is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Change plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function RoleControl({ userId, role, name, isSelf, viewer }: { userId: string; role: 'user' | 'admin'; name: string; isSelf: boolean; viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const next = role === 'admin' ? 'user' : 'admin';

  if (isSelf) {
    return (
      <p className="text-sm text-muted-foreground">
        This is your own account. You cannot remove your own admin access here; another admin, or the server command line, can.
      </p>
    );
  }

  const confirm = () =>
    startTransition(async () => {
      setResult(await changeRole({ userId, role: next }));
      router.refresh();
    });

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className={`h-10 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60 ${
          next === 'admin'
            ? 'border border-border bg-secondary/60 text-foreground hover:bg-secondary'
            : 'border border-destructive/50 text-destructive hover:bg-destructive/10'
        }`}
      >
        {next === 'admin' ? 'Make admin' : 'Remove admin access'}
      </button>
      <Result result={result} />
      <Reauth result={result} viewer={viewer} onConfirmed={() => { setResult(null); setOpen(true); }} onCancel={() => setResult(null)} />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{next === 'admin' ? `Make ${name} an admin?` : `Remove ${name}'s admin access?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {next === 'admin'
                ? 'Admins can see every account and change plans and roles. Only do this for someone you trust.'
                : 'They lose access to the admin dashboard on their next request.'}{' '}
              The change is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>{next === 'admin' ? 'Make admin' : 'Remove access'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const REASONS = [
  ['abuse', 'Abuse or misuse'],
  ['security', 'Security concern'],
  ['payment', 'Payment problem'],
  ['request', 'The person asked'],
  ['other', 'Other'],
] as const;

export function StatusControl({ userId, status, name, isSelf, viewer }: { userId: string; status: 'active' | 'suspended'; name: string; isSelf: boolean; viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const suspending = status === 'active';

  if (isSelf) return <p className="text-sm text-muted-foreground">This is your own account; you cannot suspend it.</p>;

  const confirm = () =>
    startTransition(async () => {
      setResult(await changeStatus({ userId, status: suspending ? 'suspended' : 'active', reason: suspending ? reason : undefined }));
      router.refresh();
    });

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          setReason('');
          setOpen(true);
        }}
        className={`h-10 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60 ${
          suspending ? 'border border-destructive/50 text-destructive hover:bg-destructive/10' : 'border border-border bg-secondary/60 text-foreground hover:bg-secondary'
        }`}
      >
        {suspending ? 'Suspend account' : 'Reactivate account'}
      </button>
      <Result result={result} />
      <Reauth result={result} viewer={viewer} onConfirmed={() => { setResult(null); setOpen(true); }} onCancel={() => setResult(null)} />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{suspending ? `Suspend ${name}?` : `Reactivate ${name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {suspending
                ? 'They are signed out everywhere and cannot sign in until the account is reactivated. Their data is kept.'
                : 'They can sign in again straight away.'}{' '}
              The change is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {suspending && (
            <label className="block text-sm font-medium text-foreground">
              Reason
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1.5 block h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground md:text-sm"
              >
                <option value="">Choose a reason…</option>
                {REASONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={suspending && !reason}>
              {suspending ? 'Suspend' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function TestAccountControl({ userId, test }: { userId: string; test: boolean }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div>
      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          <span id={`test-${userId}`} className="font-medium text-foreground">Test account</span>
          <span className="block text-xs text-muted-foreground">Left out of analytics and revenue figures.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={test}
          aria-labelledby={`test-${userId}`}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(await changeTestFlag({ userId, test: !test }));
              router.refresh();
            })
          }
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${test ? 'bg-primary' : 'bg-secondary ring-1 ring-border'}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${test ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </label>
      <Result result={result} />
    </div>
  );
}

const GRANT_LENGTHS = [7, 14, 30, 90, 365];
const GRANT_REASON_OPTIONS = [
  ['promotion', 'Promotion'],
  ['trial', 'Trial'],
  ['support', 'Support'],
  ['test', 'Testing'],
] as const;

export interface GrantRow {
  id: string;
  planId: PlanId;
  endsAt: string;
  reason: string;
  live: boolean;
  revoked: boolean;
}

export function GrantControl({ userId, name, grants }: { userId: string; name: string; grants: GrantRow[] }) {
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState<string>('promotion');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const format = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium text-foreground">
          For
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 block h-11 w-full rounded-lg border border-border bg-background px-3 text-base md:text-sm">
            {GRANT_LENGTHS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-foreground">
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-border bg-background px-3 text-base md:text-sm">
            {GRANT_REASON_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="mt-3 h-10 rounded-lg border border-border bg-secondary/60 px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
      >
        Give Pro for {days} days
      </button>
      <Result result={result} />
      {grants.length > 0 && (
        <ul aria-label="Access given" className="mt-4 divide-y divide-border border-t border-border">
          {grants.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{PLAN_NAMES[g.planId]}</span>{' '}
                <span className="text-muted-foreground">
                  · {g.reason} · {g.revoked ? 'ended early' : g.live ? `until ${format(g.endsAt)}` : `ended ${format(g.endsAt)}`}
                </span>
              </span>
              {g.live && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setResult(await endAccess({ userId, grantId: g.id }));
                      router.refresh();
                    })
                  }
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
                >
                  End now
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Give {name} Pro for {days} days?</AlertDialogTitle>
            <AlertDialogDescription>
              No payment is involved. Pro applies from their next request and ends on its own after {days} days; you can end it sooner. The change
              is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(async () => {
                  setResult(await giveAccess({ userId, planId: 'pro', days, reason }));
                  router.refresh();
                })
              }
            >
              Give Pro
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
