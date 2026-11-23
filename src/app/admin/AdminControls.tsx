'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
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
import {
  changePlan,
  changeRole,
  changeStatus,
  changeTestFlag,
  endAccess,
  endManualPro,
  extendAccess,
  giveAccess,
  resetPassword,
  revealPassword,
  signOutEverywhere,
  type ActionResult,
  type PasswordResult,
} from './actions';

// What an admin can change on an account, each behind a confirmation. The
// server re-checks everything (see ./actions.ts); these controls only ask and
// report. Role and status changes need a recent sign-in: when the server asks
// for one, the control offers it in place. Nothing here changes billing.

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

export function RoleControl({
  userId,
  role,
  name,
  isSelf,
  viewer,
  usernameAccount = false,
}: {
  userId: string;
  role: 'user' | 'admin';
  name: string;
  isSelf: boolean;
  viewer: Viewer;
  /** Signs in with a username: can never be made an admin (the server refuses too). */
  usernameAccount?: boolean;
}) {
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
  if (usernameAccount && role !== 'admin') {
    return (
      <p className="text-sm text-muted-foreground">
        This account signs in with a username and a password from you, so it can never be made an admin. Admin access needs a Google sign-in.
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
            : 'border border-destructive/50 text-red-400 hover:bg-destructive/10'
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
                ? 'Admins can see every account and manage access. Only do this for someone you trust.'
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
          suspending ? 'border border-destructive/50 text-red-400 hover:bg-destructive/10' : 'border border-border bg-secondary/60 text-foreground hover:bg-secondary'
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

/** What the server accepts for new grants and extensions (GRANT_LENGTHS in src/server/grants.ts). */
const MANUAL_PRO_LENGTHS = [7, 30, 90] as const;
/** No end more than this many days from today (MAX_GRANT_DAYS); the server checks it too. */
const MAX_DAYS_AHEAD = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const GRANT_REASON_OPTIONS = [
  ['promotion', 'Promotion'],
  ['trial', 'Trial'],
  ['support', 'Support'],
  ['test', 'Testing'],
] as const;

const SELECT = 'mt-1 block h-11 w-full rounded-lg border border-border bg-background px-3 text-base md:text-sm';
const SMALL_BUTTON = 'shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60';
const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const day = (value: string | number) => DAY_FORMAT.format(new Date(value));
const reasonText = (value: string) => GRANT_REASON_OPTIONS.find(([v]) => v === value)?.[1] ?? value;

export interface GrantRow {
  id: string;
  planId: PlanId;
  endsAt: string;
  reason: string;
  live: boolean;
  revoked: boolean;
  extended: boolean;
}

type ManualProDialog = { kind: 'give' } | { kind: 'extend'; grant: GrantRow } | { kind: 'end-grant'; grant: GrantRow } | { kind: 'end-no-end-date' } | { kind: 'free' };

/**
 * Manage access, without payment: Pro for 7, 30 or 90 days (a grant that ends
 * on its own), Pro with no end date (the assigned plan), or Free (every manual
 * Pro ends at once). Shows what is in force, extends or ends it, each behind a
 * confirmation that says what they keep, and keeps the history. Billing is
 * never touched: a paid subscription keeps working on its own. Nobody changes
 * their own access (the server refuses too).
 */
export function ManualProControl({
  userId,
  name,
  isSelf,
  admin,
  paid,
  noEndDate,
  grants,
}: {
  userId: string;
  name: string;
  isSelf: boolean;
  /** The account is an admin: it has every feature, whatever is given. */
  admin: boolean;
  /** A paid subscription gives them Pro right now. */
  paid: boolean;
  /** Pro with no end date (the assigned plan), and since when. */
  noEndDate: { since: string | null } | null;
  grants: GrantRow[];
}) {
  const [choice, setChoice] = useState('30');
  const [reason, setReason] = useState<string>('promotion');
  const [extendBy, setExtendBy] = useState(30);
  // The dialog keeps its content while it closes, so nothing flickers.
  const [dialog, setDialog] = useState<ManualProDialog>({ kind: 'give' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const live = grants.filter((g) => g.live);
  const earlier = grants.filter((g) => !g.live);
  const hasManualPro = Boolean(noEndDate) || live.length > 0;
  // "No end date" is offered only while they do not have it, "Free" only while they have manual Pro.
  const length = (choice === 'none' && noEndDate) || (choice === 'free' && !hasManualPro) ? '30' : choice;
  const toFree = length === 'free';
  const forever = length === 'none';
  const days = forever || toFree ? 0 : Number(length);

  const open = (next: ManualProDialog) => {
    setResult(null);
    setDialog(next);
    setDialogOpen(true);
  };
  const run = (action: () => Promise<ActionResult>) => {
    setDialogOpen(false);
    startTransition(async () => {
      setResult(await action());
      router.refresh();
    });
  };

  /** What they keep once one manual Pro ends. */
  const afterwards = (ending: { grantId?: string; noEndDate?: boolean }) => {
    if (admin) return 'As an admin they keep every feature.';
    if (paid) return 'They keep Pro through their paid subscription.';
    if (noEndDate && !ending.noEndDate) return 'They keep Pro with no end date.';
    const other = live.find((g) => g.id !== ending.grantId);
    return other ? `They keep Pro given until ${day(other.endsAt)}.` : 'They go back to Free.';
  };
  /** Pro they already have, which new manual Pro adds nothing to while it lasts. */
  const already = admin
    ? 'As an admin they already have every feature; this matters only if they stop being one.'
    : paid
    ? 'They already have Pro through a paid subscription; this matters only if it ends.'
    : noEndDate
      ? 'They already have Pro with no end date; this matters only if that ends.'
      : live[0]
        ? `They already have Pro until ${day(live[0].endsAt)}; the two run side by side.`
        : '';

  return (
    <div>
      {isSelf && (
        <p className="mb-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
          This is your account. As an admin you already have every feature, and nobody can change their own access.
        </p>
      )}

      {noEndDate || live.length > 0 ? (
        <ul aria-label="Manual Pro in force" className="divide-y divide-border rounded-xl border border-border">
          {noEndDate && (
            <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">Pro, no end date</span>
                {noEndDate.since && <span className="text-muted-foreground"> · since {day(noEndDate.since)}</span>}
              </span>
              {!isSelf && (
                <button type="button" disabled={pending} onClick={() => open({ kind: 'end-no-end-date' })} className={SMALL_BUTTON}>
                  End…
                </button>
              )}
            </li>
          )}
          {live.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">Pro until {day(g.endsAt)}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {reasonText(g.reason)}
                  {g.extended ? ' · extended' : ''}
                </span>
              </span>
              {!isSelf && (
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setExtendBy(30);
                      open({ kind: 'extend', grant: g });
                    }}
                    className={SMALL_BUTTON}
                  >
                    Extend…
                  </button>
                  <button type="button" disabled={pending} onClick={() => open({ kind: 'end-grant', grant: g })} className={SMALL_BUTTON}>
                    End now…
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None given.</p>
      )}

      {!isSelf && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className="text-sm font-medium text-foreground">
              Change to
              <select value={length} onChange={(e) => setChoice(e.target.value)} className={SELECT}>
                {MANUAL_PRO_LENGTHS.map((d) => (
                  <option key={d} value={String(d)}>
                    Pro for {d} days
                  </option>
                ))}
                {!noEndDate && <option value="none">Pro, no end date</option>}
                {hasManualPro && <option value="free">Free (end manual Pro)</option>}
              </select>
            </label>
            {!toFree && (
              <label className="text-sm font-medium text-foreground">
                Reason
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={SELECT}>
                  {GRANT_REASON_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => open(toFree ? { kind: 'free' } : { kind: 'give' })}
            className="mt-3 h-10 rounded-lg border border-border bg-secondary/60 px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
          >
            {toFree ? 'End manual Pro…' : forever ? 'Give Pro with no end date' : `Give Pro for ${days} days`}
          </button>
        </>
      )}
      <Result result={result} />

      {earlier.length > 0 && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">Earlier ({earlier.length})</summary>
          <ul aria-label="Earlier manual Pro" className="mt-2 divide-y divide-border">
            {earlier.map((g) => (
              <li key={g.id} className="py-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{PLAN_NAMES[g.planId]}</span> · {reasonText(g.reason)} ·{' '}
                {g.revoked ? 'ended early' : `ended ${day(g.endsAt)}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          {dialog.kind === 'give' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{forever ? `Give ${name} Pro with no end date?` : `Give ${name} Pro for ${days} days?`}</AlertDialogTitle>
                <AlertDialogDescription>
                  No payment is involved, and their billing is not changed.{' '}
                  {forever
                    ? 'Pro applies from their next request and lasts until you end it.'
                    : `Pro applies from their next request and ends on its own on ${day(Date.now() + days * DAY_MS)}; you can extend or end it sooner.`}{' '}
                  {already && `${already} `}The change is recorded in the activity log.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => run(() => (forever ? changePlan({ userId, plan: 'pro', reason }) : giveAccess({ userId, planId: 'pro', days, reason })))}
                >
                  Give Pro
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog.kind === 'extend' &&
            (() => {
              const grant = dialog.grant;
              const end = new Date(grant.endsAt).getTime() + extendBy * DAY_MS;
              const tooLong = end > Date.now() + MAX_DAYS_AHEAD * DAY_MS;
              return (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Extend {name}&rsquo;s Pro?</AlertDialogTitle>
                    <AlertDialogDescription>
                      From its current end, {day(grant.endsAt)}. No payment is involved, and their billing is not changed. The change is recorded in the activity log.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <label className="text-sm font-medium text-foreground">
                    By
                    <select value={extendBy} onChange={(e) => setExtendBy(Number(e.target.value))} className={SELECT}>
                      {MANUAL_PRO_LENGTHS.map((d) => (
                        <option key={d} value={d}>
                          {d} days
                        </option>
                      ))}
                    </select>
                  </label>
                  <p aria-live="polite" className={`text-sm ${tooLong ? 'text-destructive' : 'text-foreground'}`}>
                    {tooLong ? 'That would end more than a year from today. Choose a shorter extension, or give Pro with no end date.' : `New end: ${day(end)}`}
                  </p>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={tooLong} onClick={() => run(() => extendAccess({ userId, grantId: grant.id, days: extendBy }))}>
                      Extend
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              );
            })()}
          {dialog.kind === 'end-grant' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>End {name}&rsquo;s Pro now?</AlertDialogTitle>
                <AlertDialogDescription>
                  The Pro given until {day(dialog.grant.endsAt)} ends from their next request. {afterwards({ grantId: dialog.grant.id })} Their billing is not changed. The
                  change is recorded in the activity log.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(() => endAccess({ userId, grantId: dialog.grant.id }))}>End now</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog.kind === 'free' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>End all of {name}&rsquo;s manual Pro?</AlertDialogTitle>
                <AlertDialogDescription>
                  {[noEndDate ? 'Pro with no end date' : null, live.length === 1 ? `Pro until ${day(live[0].endsAt)}` : live.length > 1 ? `${live.length} grants of Pro for a time` : null]
                    .filter(Boolean)
                    .join(' and ')}{' '}
                  {noEndDate && live.length === 0 ? 'ends' : 'end'} from their next request.{' '}
                  {admin ? 'As an admin they keep every feature.' : paid ? 'They keep Pro through their paid subscription.' : 'They go back to Free.'} Their billing is not
                  changed. Each change is recorded in the activity log.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(() => endManualPro({ userId }))}>End manual Pro</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog.kind === 'end-no-end-date' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>End {name}&rsquo;s Pro with no end date?</AlertDialogTitle>
                <AlertDialogDescription>
                  It ends from their next request. {afterwards({ noEndDate: true })} Their billing is not changed. The change is recorded in the activity log.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(() => changePlan({ userId, plan: 'free' }))}>End</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const UTC_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/**
 * A password handed out once: shown with its username until "Done", never
 * kept by the page (no storage), never shown again by the server.
 */
export function OneTimePassword({ credentials, onDone }: { credentials: { username: string; password: string }; onDone: () => void }) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(credentials.password);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }
  return (
    <section aria-label="Password to hand over" className="mt-3 rounded-xl border border-primary/50 bg-primary/5 p-4">
      <p className="text-sm font-semibold text-foreground">Shown once: copy it now</p>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Username</dt>
          <dd dir="ltr" className="mt-0.5 break-all font-mono text-base text-foreground">
            {credentials.username}
          </dd>
        </div>
        <div>
          <dt id="one-time-password" className="text-xs font-medium text-muted-foreground">
            Password
          </dt>
          <dd className="mt-1">
            <input
              readOnly
              value={credentials.password}
              aria-labelledby="one-time-password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              className="block h-12 w-full rounded-lg border border-border bg-background px-3 font-mono text-base tracking-wide text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Give it to the tester in person or in a private message. It is not stored anywhere and cannot be shown again; if it is lost, reset the password. They can
        change it on their account page.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={copy}
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {copied === 'ok' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied === 'ok' ? 'Copied' : 'Copy password'}
        </button>
        <button type="button" onClick={onDone} className="h-11 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-secondary">
          Done
        </button>
      </div>
      <p role="status" className={copied === 'failed' ? 'mt-2 text-xs text-destructive' : 'sr-only'}>
        {copied === 'ok' ? 'Password copied.' : copied === 'failed' ? 'Could not copy here: select the password and copy it.' : ''}
      </p>
    </section>
  );
}

/**
 * A username account's password: an initial one from the server command line
 * waiting to be revealed once, and a reset that makes a new one. Both need a
 * recent sign-in, and both show the password once.
 */
export function PasswordControl({
  userId,
  name,
  viewer,
  initialPassword,
}: {
  userId: string;
  name: string;
  viewer: Viewer;
  /** ISO time until which an initial password can be revealed, or null. */
  initialPassword: string | null;
}) {
  const [confirm, setConfirm] = useState<'reset' | 'reveal' | null>(null);
  const [last, setLast] = useState<'reset' | 'reveal'>('reset');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [credentials, setCredentials] = useState<PasswordResult['credentials'] | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (what: 'reset' | 'reveal') => {
    setLast(what);
    startTransition(async () => {
      const reply = what === 'reset' ? await resetPassword({ userId }) : await revealPassword({ userId });
      setCredentials(reply.credentials ?? null);
      setResult({ ok: reply.ok, message: reply.message, reauth: reply.reauth });
      router.refresh();
    });
  };

  return (
    <div>
      {initialPassword && !credentials && (
        <div className="mb-4 rounded-xl border border-border bg-secondary/40 p-3">
          <p className="text-sm font-medium text-foreground">An initial password is waiting</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Made on the server command line. It can be revealed once, until {UTC_TIME.format(new Date(initialPassword))} UTC; then it is gone.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setResult(null);
              setConfirm('reveal');
            }}
            className="mt-3 h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            Reveal initial password
          </button>
        </div>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          setCredentials(null);
          setConfirm('reset');
        }}
        className="h-10 rounded-lg border border-border bg-secondary/60 px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
      >
        Reset password
      </button>
      {result && !credentials && <Result result={result} />}
      {result && credentials && <p role="status" className="mt-2 text-xs text-primary">{result.message}</p>}
      <Reauth result={result} viewer={viewer} onConfirmed={() => { setResult(null); setConfirm(last); }} onCancel={() => setResult(null)} />
      {credentials && <OneTimePassword credentials={credentials} onDone={() => { setCredentials(null); setResult(null); }} />}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'reveal' ? `Reveal ${name}'s initial password?` : `Reset ${name}'s password?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'reveal'
                ? 'You see it once; it is then removed from the server, so make sure you can copy it now.'
                : 'A new password replaces the current one, which stops working at once, and they are signed out on every device. You see the new password once.'}{' '}
              This is recorded in the activity log (never the password).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && run(confirm)}>{confirm === 'reveal' ? 'Reveal' : 'Reset password'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** End every session of an account (not the admin's own: that is on their account page). */
export function SessionsControl({ userId, name, isSelf, active }: { userId: string; name: string; isSelf: boolean; active: number }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (isSelf) return <p className="text-sm text-muted-foreground">Your own sessions are on your account page (Signed-in devices).</p>;
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="h-10 rounded-lg border border-border bg-secondary/60 px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
      >
        Sign out everywhere
      </button>
      <Result result={result} />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign {name} out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              {active === 1 ? 'Its one active session ends' : `All ${active} active sessions end`} at once; they can sign in again. The change is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(async () => {
                  setResult(await signOutEverywhere({ userId }));
                  router.refresh();
                })
              }
            >
              Sign out everywhere
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
