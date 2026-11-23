import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BadgeCheck } from 'lucide-react';
import { AccountAvatar } from '@/components/shell/account';
import { formatMoney } from '@/lib/money';
import { FEATURE_LABELS, FEATURES, PLAN_NAMES } from '@/lib/plans';
import { getUserDetail, mayChangeRoles, type AdminUserDetail } from '@/server/admin';
import { signInMethods } from '@/server/account-management';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { requireAdmin } from '@/server/session';
import { ManualProControl, PasswordControl, RoleControl, SessionsControl, StatusControl, TestAccountControl, type Viewer } from '../../AdminControls';
import { AdminShell } from '../../AdminShell';
import { EventList } from '../../EventList';
import { SUBSCRIPTION_STATUS_LABELS, dateOnly, dateTime, sourceLong, sourceShort } from '../../format';

// One account, as an admin supports it: identity and sign-in methods, access
// (what is in force and why), managing access (Pro for a time or with no end
// date, or back to Free),
// billing (read-only, as the payment provider reported it), role, status,
// activity, and what an admin can change. Access and billing are separate:
// nothing an admin does here changes billing. Never shows tokens, session
// secrets, password hashes or Google's full account id. The owner's account
// shows no controls to any other admin (the server refuses them anyway).

export const metadata: Metadata = { title: 'Account · Studio Companion admin', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin('/admin');
  const userId = toObjectId(id);
  if (!userId) notFound();
  const db = getDb();
  const [user, viewerMethods, canChangeRoles] = await Promise.all([getUserDetail(db, userId), signInMethods(db, admin.id), mayChangeRoles(db, admin.id)]);
  if (!user) notFound();
  const viewer: Viewer = { email: admin.user.email, hasPassword: viewerMethods.password !== null, returnTo: `/admin/users/${user.id}` };

  const isSelf = admin.id.equals(userId);
  // The owner's account, seen by another admin: nothing here can change it.
  const ownerLocked = user.owner && !isSelf;
  const { entitlements } = user;
  const access =
    entitlements.access === 'admin'
      ? 'Every feature (admin)'
      : entitlements.access === 'none'
        ? 'Nothing (account not active)'
        : PLAN_NAMES[entitlements.planId];
  const proSources = user.sources.filter((s) => s.kind !== 'admin');
  const usage = FEATURES.filter((f) => (user.usageThisMonth[f] ?? 0) > 0);

  return (
    <AdminShell active={null}>
      <Link href="/admin" className="mt-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All users
      </Link>

      <header className="mt-3 flex items-center gap-4">
        <AccountAvatar account={{ name: user.name, email: user.email, image: user.image }} size={56} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{user.name}</h1>
          {user.username ? (
            // Its stored address is only a placeholder (src/lib/username.ts).
            <p className="truncate text-sm text-muted-foreground">
              Username <span className="font-medium text-foreground">{user.username}</span>
            </p>
          ) : (
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <span className="truncate">{user.email}</span>
              {user.emailVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified by Google" />}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {user.role === 'admin' && <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${entitlements.planId === 'pro' || entitlements.access === 'admin' ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground'}`}>
              {entitlements.access === 'admin' ? 'Every feature' : PLAN_NAMES[entitlements.planId]}
              {proSources.length > 0 && <span className="font-normal"> · {proSources.map(sourceShort).join(' + ')}</span>}
            </span>
            {user.status !== 'active' && <span className="rounded-full border border-destructive/50 px-2 py-0.5 text-xs text-destructive">{user.status}</span>}
            {user.testAccount && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Test</span>}
            {user.username && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Username sign-in</span>}
            {user.owner && <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Owner</span>}
            {isSelf && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">You</span>}
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card title="Account">
          <dl className="space-y-2.5 text-sm">
            {user.username ? (
              <>
                <Row label="Signs in with">Username and password</Row>
                <Row label="Email">None (no email is used)</Row>
              </>
            ) : (
              <Row label="Email">{user.emailVerified ? (user.google.linked ? 'Verified by Google' : 'Verified') : 'Not verified'}</Row>
            )}
            <Row label="Google account">{user.google.linked ? `Linked · id ${user.google.idHint} · since ${dateOnly(user.google.linkedAt)}` : 'Not linked'}</Row>
            <Row label="Password">{user.password ? `Set · since ${dateOnly(user.password.setAt)}` : 'None'}</Row>
            <Row label="Registered">{dateTime(user.createdAt)}</Row>
            <Row label="Last login">{dateTime(user.lastLoginAt)}</Row>
            <Row label="Sign-ins">{user.logins}</Row>
            <Row label="Active sessions">{user.sessions.active}</Row>
            <Row label="Last active">{dateTime(user.sessions.lastActiveAt)}</Row>
          </dl>
        </Card>

        <Card title="Access">
          <dl className="space-y-2.5 text-sm">
            <Row label="In force">{access}</Row>
          </dl>
          {user.status !== 'active' && <p className="mt-2 text-sm text-destructive">Suspended: nothing below applies until the account is reactivated.</p>}
          <p className="mb-1.5 mt-4 text-sm text-muted-foreground">Why</p>
          {user.sources.length === 0 ? (
            <p className="text-sm text-foreground">Nothing given and no paid subscription, so Free.</p>
          ) : (
            <ul aria-label="Where access comes from" className="space-y-2 text-sm">
              {user.sources.map((source, i) => {
                const { label, detail } = sourceLong(source);
                return (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-foreground">{label}</span>
                    <span className="min-w-0 text-foreground">{detail}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <dl className="mt-4 space-y-2.5 border-t border-border pt-4 text-sm">
            {/* What the studio opens for this account right now (the published plans; the same answer the studio and the server follow). */}
            <Row label="Can use">{entitlements.features.length > 0 ? entitlements.features.map((f) => FEATURE_LABELS[f]).join(', ') : 'Nothing'}</Row>
          </dl>
        </Card>

        <Card title="Manage access">
          <p className="mb-3 text-sm text-muted-foreground">
            Give Pro without payment for 7, 30 or 90 days or with no end date, or end it (back to Free). It never changes their billing, and a paid
            subscription keeps working on its own.
          </p>
          {ownerLocked ? (
            <OwnerNote />
          ) : (
          <ManualProControl
            userId={user.id}
            name={user.name}
            isSelf={isSelf}
            admin={user.role === 'admin'}
            paid={user.sources.some((s) => s.kind === 'paid')}
            noEndDate={user.plan === 'pro' ? { since: user.planUpdatedAt?.toISOString() ?? null } : null}
            grants={user.grants.map((g) => ({
              id: g.id,
              planId: g.planId,
              endsAt: g.endsAt.toISOString(),
              reason: g.reason,
              live: g.live,
              revoked: g.revokedAt !== null,
              extended: g.extendedAt !== null,
            }))}
          />
          )}
        </Card>

        <Card title="Billing">
          <Billing subscription={user.subscription} payments={user.payments} />
        </Card>

        <Card title="Role">
          <p className="mb-3 text-sm text-muted-foreground">
            {user.role === 'admin' ? (user.owner ? 'Owner and administrator: opens this dashboard, manages accounts, and is the only one who changes roles.' : 'Administrator: opens this dashboard and manages accounts.') : 'Member: uses the studio; no admin access.'} The role is separate from the plan: Pro never grants admin access.
          </p>
          {ownerLocked ? (
            <OwnerNote />
          ) : canChangeRoles ? (
            <RoleControl userId={user.id} role={user.role} name={user.name} isSelf={isSelf} viewer={viewer} usernameAccount={user.username !== null} />
          ) : (
            <p className="text-sm text-muted-foreground">Only the owner can change who is an admin.</p>
          )}
        </Card>

        <Card title="Password and sessions">
          {user.username ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Signs in as <span className="font-medium text-foreground">{user.username}</span>. A reset makes a new password (you see it once), stops the old
                one and signs them out on every device. Nobody can see the current password.
              </p>
              <PasswordControl userId={user.id} name={user.name} viewer={viewer} initialPassword={user.initialPassword?.expiresAt.toISOString() ?? null} />
            </>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">
              {user.google.linked ? 'Signs in with Google: there is no password here to reset.' : 'Passwords can be reset only for accounts that sign in with a username.'}
            </p>
          )}
          <div className={`text-sm ${user.username ? 'mt-4 border-t border-border pt-4' : ''}`}>
            <p className="mb-3 text-muted-foreground">
              {user.sessions.active === 0 ? 'Not signed in anywhere right now.' : `Signed in on ${user.sessions.active} ${user.sessions.active === 1 ? 'device' : 'devices'}.`}
            </p>
            {ownerLocked ? <OwnerNote /> : <SessionsControl userId={user.id} name={user.name} isSelf={isSelf} active={user.sessions.active} />}
          </div>
        </Card>

        <Card title="Status">
          <p className="mb-3 text-sm text-muted-foreground">
            {user.suspension
              ? `Suspended${user.suspension.at ? ` on ${dateOnly(user.suspension.at)}` : ''}${user.suspension.reason ? ` (${user.suspension.reason})` : ''}: cannot sign in.`
              : 'Active: can sign in and use the studio.'}
          </p>
          {ownerLocked ? (
            <OwnerNote />
          ) : (
            <>
              <StatusControl userId={user.id} status={user.status} name={user.name} isSelf={isSelf} viewer={viewer} />
              <div className="mt-4 border-t border-border pt-4">
                <TestAccountControl userId={user.id} test={user.testAccount} />
              </div>
            </>
          )}
        </Card>

        <Card title="Usage this month">
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing counted yet this month.</p>
          ) : (
            <dl className="space-y-2.5 text-sm">
              {usage.map((f) => (
                <Row key={f} label={FEATURE_LABELS[f]}>{user.usageThisMonth[f]}</Row>
              ))}
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Counted by the server when a GIF is made. Images themselves are never uploaded.</p>
        </Card>
      </div>

      <section aria-labelledby="account-activity" className="mt-4 rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 id="account-activity" className="text-base font-semibold text-foreground">Activity</h2>
        <EventList events={user.events} viewerId={admin.id.toHexString()} showSubject={false} />
      </section>
    </AdminShell>
  );
}

const money = (amountMinor: number | null, currency: string | null) => (typeof amountMinor === 'number' && currency ? formatMoney(amountMinor, currency as 'USD') : '—');

/** Billing exactly as the payment provider's verified events recorded it. Read-only: nothing here changes it. */
function Billing({ subscription: sub, payments }: Pick<AdminUserDetail, 'subscription' | 'payments'>) {
  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Read-only, as the payment provider reported it. Nothing an admin does changes billing. No payment provider is connected yet.
      </p>
      <dl className="space-y-2.5 text-sm">
        <Row label="Subscription">
          {sub ? `${PLAN_NAMES[sub.planId]}${sub.interval ? ` · ${sub.interval === 'year' ? 'yearly' : 'monthly'}` : ''} · ${money(sub.amountMinor, sub.currency)}` : 'None'}
        </Row>
        {sub && (
          <>
            <Row label="Status">
              {SUBSCRIPTION_STATUS_LABELS[sub.status]}
              {sub.endedAt
                ? ` · ended ${dateOnly(sub.endedAt)}`
                : sub.currentPeriodEnd
                  ? sub.cancelAtPeriodEnd || sub.status === 'canceled'
                    ? ` · ends ${dateOnly(sub.currentPeriodEnd)}`
                    : ` · renews ${dateOnly(sub.currentPeriodEnd)}`
                  : ''}
            </Row>
            {sub.trialEndsAt && <Row label="Trial ends">{dateOnly(sub.trialEndsAt)}</Row>}
            <Row label="Provider">{sub.provider}</Row>
          </>
        )}
      </dl>
      <p className="mb-1.5 mt-4 text-sm text-muted-foreground">Payments</p>
      {payments.length === 0 ? (
        <p className="text-sm text-foreground">None recorded.</p>
      ) : (
        <ul aria-label="Payments" className="divide-y divide-border text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
              <span className="tabular-nums text-foreground">
                {p.kind === 'refund' ? 'Refund' : p.kind === 'chargeback' ? 'Dispute' : 'Charge'} {money(p.amountMinor, p.currency)}
                {p.status === 'failed' && <span className="ms-1 font-semibold text-destructive">failed</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {dateOnly(p.occurredAt)}
                {p.receiptUrl?.startsWith('https://') && (
                  <>
                    {' · '}
                    <a href={p.receiptUrl} rel="noreferrer" target="_blank" className="underline underline-offset-2 hover:text-foreground">
                      receipt
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin/billing" className="mt-3 inline-block text-sm text-primary underline-offset-2 hover:underline">
        All billing
      </Link>
    </>
  );
}

/** In place of the controls on the owner's account, for every other admin. */
function OwnerNote() {
  return <p className="text-sm text-muted-foreground">This is the owner&rsquo;s account: only the owner can change it.</p>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-card p-4 md:p-5">
      <h2 className="mb-3 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}
