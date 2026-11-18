import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { usernamePasswordAvailable } from '@/server/auth';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../../AdminShell';
import { CreateTesterForm } from './CreateTesterForm';

// A new account for an invited tester: a username and a password the admin
// hands over (ADR-0012). Nobody can create one of these accounts themselves.

export const metadata: Metadata = { title: 'New tester account · Studio Companion admin', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

export default async function NewTesterPage() {
  await requireAdmin('/admin/users/new');
  const enabled = usernamePasswordAvailable();
  return (
    <AdminShell active="users">
      <Link href="/admin" className="mt-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All users
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">New tester account</h1>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        The tester signs in with a username and a password you give them; no Google account or email is needed. Only admins can create these
        accounts: there is no sign-up for them.
      </p>
      {enabled ? (
        <CreateTesterForm />
      ) : (
        <p className="mt-5 max-w-xl rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Username sign-in is off on this server (AUTH_USERNAME_PASSWORD), so a username account could not sign in. It is turned on by the server
          operator.
        </p>
      )}
    </AdminShell>
  );
}
