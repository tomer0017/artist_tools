import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BadgeCheck } from 'lucide-react';
import { AccountAvatar } from '@/components/shell/account';
import { FEATURE_LABELS, FEATURES, PLAN_NAMES } from '@/lib/plans';
import { getUserDetail } from '@/server/admin';
import { signInMethods } from '@/server/account-management';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { requireAdmin } from '@/server/session';
import { GrantControl, PlanControl, RoleControl, StatusControl, TestAccountControl, type Viewer } from '../../AdminControls';
import { AdminShell } from '../../AdminShell';
import { EventList } from '../../EventList';
import { dateOnly, dateTime } from '../../format';

// One account, as an admin supports it: identity and sign-in methods, access
// (role, plan, subscription, time-limited grants, what is included), status,
// activity, and what an admin can change. Never shows tokens, session secrets,
// password hashes or Google's full account id.

export const metadata: Metadata = { title: 'Account · Studio Companion admin', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin('/admin');
  const userId = toObjectId(id);
  if (!userId) notFound();
  const db = getDb();
  const [user, viewerMethods] = await Promise.all([getUserDetail(db, userId), signInMethods(db, admin.id)]);
  if (!user) notFound();
  const viewer: Viewer = { email: admin.user.email, hasPassword: viewerMethods.password !== null, returnTo: `/admin/users/${user.id}` };
  const liveGrant = user.grants.find((g) => g.live) ?? null;

  const isSelf = admin.id.equals(userId);
  const { entitlements } = user;
  const access =
    entitlements.access === 'admin'
      ? 'Every feature (admin)'
      : entitlements.access === 'none'
        ? 'Nothing (account not active)'
        : `${PLAN_NAMES[entitlements.planId]} features${liveGrant ? ` (given until ${dateOnly(liveGrant.endsAt)})` : ''}`;
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
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span className="truncate">{user.email}</span>
            {user.emailVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified by Google" />}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {user.role === 'admin' && <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${user.plan === 'pro' ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground'}`}>{PLAN_NAMES[user.plan]}</span>
            {user.status !== 'active' && <span className="rounded-full border border-destructive/50 px-2 py-0.5 text-xs text-destructive">{user.status}</span>}
            {liveGrant && <span className="rounded-full border border-primary/40 px-2 py-0.5 text-xs text-primary">Pro given</span>}
            {user.testAccount && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Test</span>}
            {isSelf && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">You</span>}
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card title="Account">
          <dl className="space-y-2.5 text-sm">
            <Row label="Email">{user.emailVerified ? (user.google.linked ? 'Verified by Google' : 'Verified') : 'Not verified'}</Row>
            <Row label="Google account">{user.google.linked ? `Linked · id ${user.google.idHint} · since ${dateOnly(user.google.linkedAt)}` : 'Not linked'}</Row>
            <Row label="Password">{user.password ? `Set · since ${dateOnly(user.password.setAt)}` : 'None'}</Row>
            <Row label="Registered">{dateTime(user.createdAt)}</Row>
            <Row label="Last login">{dateTime(user.lastLoginAt)}</Row>
            <Row label="Sign-ins">{user.logins}</Row>
            <Row label="Active sessions">{user.sessions.active}</Row>
            <Row label="Last active">{dateTime(user.sessions.lastActiveAt)}</Row>
          </dl>
        </Card>

        <Card title="Plan and access">
          <p className="mb-2 text-sm text-muted-foreground">Assigned plan</p>
          <PlanControl userId={user.id} plan={user.plan} name={user.name} />
          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="In force">{access}</Row>
            <Row label="Subscription">{user.subscription ? `${user.subscription.status} (${PLAN_NAMES[user.subscription.planId]})` : 'None (billing is not live)'}</Row>
            <Row label="Plan last changed">{dateTime(user.planUpdatedAt)}</Row>
          </dl>
        </Card>

        <Card title="Role">
          <p className="mb-3 text-sm text-muted-foreground">
            {user.role === 'admin' ? 'Administrator: can open this dashboard and change plans and roles.' : 'Member: uses the studio; no admin access.'} The role is separate from the plan: Pro never grants admin access.
          </p>
          <RoleControl userId={user.id} role={user.role} name={user.name} isSelf={isSelf} viewer={viewer} />
        </Card>

        <Card title="Status">
          <p className="mb-3 text-sm text-muted-foreground">
            {user.suspension
              ? `Suspended${user.suspension.at ? ` on ${dateOnly(user.suspension.at)}` : ''}${user.suspension.reason ? ` (${user.suspension.reason})` : ''}: cannot sign in.`
              : 'Active: can sign in and use the studio.'}
          </p>
          <StatusControl userId={user.id} status={user.status} name={user.name} isSelf={isSelf} viewer={viewer} />
          <div className="mt-4 border-t border-border pt-4">
            <TestAccountControl userId={user.id} test={user.testAccount} />
          </div>
        </Card>

        <Card title="Promotional access">
          <p className="mb-3 text-sm text-muted-foreground">
            Give Pro for a limited time (a promotion, a trial, support). It ends on its own and never changes the assigned plan.
          </p>
          <GrantControl
            userId={user.id}
            name={user.name}
            grants={user.grants.map((g) => ({ id: g.id, planId: g.planId, endsAt: g.endsAt.toISOString(), reason: g.reason, live: g.live, revoked: g.revokedAt !== null }))}
          />
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
