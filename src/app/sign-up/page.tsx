import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import SignUpCard from '@/components/auth/SignUpCard';
import { safeCallbackPath } from '@/lib/redirects';
import { emailPasswordAvailable, registrationMode } from '@/server/auth';
import { getSession } from '@/server/session';

export const metadata: Metadata = {
  title: 'Create your account · Studio Companion',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Email + password registration; does not exist where that sign-in method is off.
export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!emailPasswordAvailable()) notFound();
  const callbackPath = safeCallbackPath(first((await searchParams).callbackURL));
  if (await getSession()) redirect(callbackPath);
  return <SignUpCard callbackPath={callbackPath} registration={registrationMode()} />;
}
