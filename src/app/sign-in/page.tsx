import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SignInCard from '@/components/auth/SignInCard';
import { safeCallbackPath } from '@/lib/redirects';
import { getT } from '@/i18n/server';
import { emailPasswordAvailable, googleSignInAvailable, registrationMode } from '@/server/auth';
import { getSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  return { title: t('signInTitle'), robots: { index: false, follow: false }, alternates: { languages: { en: '/sign-in', he: '/he/sign-in' } } };
}

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Better Auth reports failed sign-ins with an error code; show people what
// happened in plain words (the code itself is not shown).
const KNOWN_ERRORS = ['access_denied', 'account_not_linked', 'not_invited', 'unable_to_create_user', 'unable_to_create_session'] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(first(params.callbackURL));
  if (await getSession()) redirect(callbackPath);
  const error = first(params.error);
  const t = await getT('auth');
  const message = error ? t(`errors.${(KNOWN_ERRORS as readonly string[]).includes(error) ? (error as KnownError) : 'generic'}`) : null;
  return (
    <SignInCard
      callbackPath={callbackPath}
      available={googleSignInAvailable()}
      registration={registrationMode()}
      emailPassword={emailPasswordAvailable()}
      error={message}
    />
  );
}
