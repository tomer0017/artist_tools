import type { Metadata } from 'next';
import { mfaStatus } from '@/server/admin-mfa';
import { signInMethods } from '@/server/account-management';
import { getDb } from '@/server/db/client';
import { authConfig } from '@/server/env';
import { requireAdmin, signedInRecently } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { dateTime } from '../format';
import { MfaSettings } from './MfaSettings';

// Two-factor verification for this administrator (docs/security/admin-2fa.md):
// set up an authenticator app, keep one-time recovery codes, replace them,
// or turn it off. Once on, every new session asks for a code before any
// admin page or action. Required for all admins only if ADMIN_MFA_REQUIRED=on.

export const metadata: Metadata = { title: 'Security · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  const admin = await requireAdmin('/admin/security', { allowEnrollment: true });
  const db = getDb();
  const [status, methods] = await Promise.all([mfaStatus(db, admin.id), signInMethods(db, admin.id)]);
  const required = authConfig().adminMfaRequired;

  return (
    <AdminShell active="security">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Security</h1>
      <section aria-labelledby="mfa-heading" className="mt-4 max-w-2xl rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 id="mfa-heading" className="text-base font-semibold text-foreground">
          Two-factor verification
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A code from an authenticator app on your phone (Apple Passwords, Google Authenticator, 1Password…) is asked for once in every new
          session, before the admin dashboard opens — whether you sign in with Google or a password.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Required for every administrator: <strong className="text-foreground">{required ? 'yes' : 'no'}</strong>
          {required ? '' : ' (it becomes required only when the owner approves; until then it is your choice).'}
        </p>
        <MfaSettings
          enrolled={status.enrolled}
          since={status.confirmedAt ? dateTime(status.confirmedAt) : null}
          recoveryCodesLeft={status.recoveryCodesLeft}
          fresh={signedInRecently(admin.signedInAt)}
          viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/security?confirmed=1' }}
        />
      </section>
    </AdminShell>
  );
}
