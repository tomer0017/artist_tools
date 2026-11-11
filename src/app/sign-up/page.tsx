import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { notFound, redirect } from 'next/navigation';
import SignUpCard from '@/components/auth/SignUpCard';
import { safeCallbackPath } from '@/lib/redirects';
import { emailPasswordAvailable, registrationMode } from '@/server/auth';
import { getSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  return { title: t('signUpTitle'), robots: { index: false, follow: false }, alternates: { languages: { en: '/sign-up', he: '/he/sign-up' } } };
}

export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Email + password registration; does not exist where that sign-in method is off.
export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!emailPasswordAvailable()) notFound();
  const callbackPath = safeCallbackPath(first((await searchParams).callbackURL));
  if (await getSession()) redirect(callbackPath);
  return <SignUpCard callbackPath={callbackPath} registration={registrationMode()} />;
}
