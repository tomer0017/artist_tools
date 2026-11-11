import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminAccessGate, requireAdminRole, safeAdminPath } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { VerifyForm } from './VerifyForm';

// The second factor for this session: an administrator who enrolled enters a
// code from their authenticator app (or a recovery code) before the admin
// dashboard opens, then returns where they were going.

export const metadata: Metadata = { title: 'Verify · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminVerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).returnTo;
  const returnTo = safeAdminPath(typeof raw === 'string' ? raw : null);
  const admin = await requireAdminRole('/admin');
  const gate = await adminAccessGate(admin);
  if (gate === 'ok') redirect(returnTo);
  if (gate === 'enroll') redirect('/admin/security');

  return (
    <AdminShell active={null} bare>
      <section aria-labelledby="verify-heading" className="mx-auto mt-10 max-w-md rounded-2xl border border-border bg-card p-5">
        <h1 id="verify-heading" className="text-xl font-bold tracking-tight text-foreground">
          Two-factor verification
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app to open the admin dashboard.</p>
        <VerifyForm returnTo={returnTo} />
      </section>
    </AdminShell>
  );
}
