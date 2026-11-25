import type { Metadata } from 'next';
import { readDeviceToken } from '@/server/admin-device-cookie';
import { listTrustedDevices, mfaStatus } from '@/server/admin-mfa';
import { signInMethods } from '@/server/account-management';
import { getDb } from '@/server/db/client';
import { authConfig } from '@/server/env';
import { requireAdmin, signedInRecently } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { dateOnly, dateTime } from '../format';
import { MfaSettings } from './MfaSettings';
import { TrustedDevices } from './TrustedDevices';

// Two-factor verification for this administrator (docs/security/admin-2fa.md):
// set up an authenticator app, keep one-time recovery codes, replace them,
// or turn it off. Once on, every new session asks for a code before any
// admin page or action, except on a device trusted after a code (listed here,
// each can be forgotten). Required for all admins only if ADMIN_MFA_REQUIRED=on.

export const metadata: Metadata = { title: 'Security · SketchyArtLab admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  const admin = await requireAdmin('/admin/security', { allowEnrollment: true });
  const db = getDb();
  const [status, methods, devices] = await Promise.all([mfaStatus(db, admin.id), signInMethods(db, admin.id), listTrustedDevices(db, admin.id, await readDeviceToken())]);
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
          session, before the admin dashboard opens — whether you sign in with Google or a password — except on a device you trusted.
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
      {status.enrolled && (
        <section aria-labelledby="devices-heading" className="mt-4 max-w-2xl rounded-2xl border border-border bg-card p-4 md:p-5">
          <h2 id="devices-heading" className="text-base font-semibold text-foreground">
            Trusted devices
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            After a code, a device you trust opens the admin dashboard without one: until it goes unused for 30 days, and at most 90 days after its
            last code. You still sign in with Google on it. Signing out keeps the trust; &ldquo;Shared device? Sign out…&rdquo; ends it.
          </p>
          <TrustedDevices
            devices={devices.map((d) => ({ id: d.id, label: d.label, trusted: dateOnly(d.createdAt), lastUsed: dateTime(d.lastUsedAt), asksAgain: dateOnly(d.expiresAt), current: d.current }))}
          />
        </section>
      )}
    </AdminShell>
  );
}
