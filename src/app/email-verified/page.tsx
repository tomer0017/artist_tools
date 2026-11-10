import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard, Notice } from '@/components/auth/AuthCard';
import { PRIMARY_BUTTON } from '@/components/auth/ui';
import { safeCallbackPath, signInPath } from '@/lib/redirects';
import { getSession } from '@/server/session';

export const metadata: Metadata = {
  title: 'Email address · Studio Companion',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Where a verification link (and an email sign-in) comes back to. Better Auth
// has already verified the address and signed the person in, or added
// ?error=… when the link was expired or already used.
export default async function EmailVerifiedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeCallbackPath(first(params.next));
  const error = first(params.error);
  if (!error && (await getSession())) redirect(next);

  return (
    <AuthCard title={error ? 'This link no longer works' : 'Email address confirmed'}>
      {error ? (
        <Notice tone="error">
          The link has expired or was already used. Sign in with your email and password, and we will send you a new one if your address still
          needs confirming.
        </Notice>
      ) : (
        <Notice tone="success">Thank you: your email address is confirmed. Sign in to continue.</Notice>
      )}
      <Link href={signInPath(next)} className={`mt-6 ${PRIMARY_BUTTON}`}>
        Sign in
      </Link>
    </AuthCard>
  );
}
