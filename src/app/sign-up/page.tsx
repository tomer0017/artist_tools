import type { Metadata } from 'next';
import { localizedPath } from '@/i18n/config';
import { addressLocale, getT } from '@/i18n/server';
import { redirect } from 'next/navigation';
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

// Email + password registration. Where that method is off there is no
// separate registration (Google sign-in creates the account), so this address
// leads to sign-in.
export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const callbackPath = safeCallbackPath(first((await searchParams).callbackURL));
  if (!emailPasswordAvailable()) redirect(`${localizedPath('/sign-in', await addressLocale())}?callbackURL=${encodeURIComponent(callbackPath)}`);
  if (await getSession()) redirect(callbackPath);
  return <SignUpCard callbackPath={callbackPath} registration={registrationMode()} />;
}
