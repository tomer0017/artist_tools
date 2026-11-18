import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SignInCard from '@/components/auth/SignInCard';
import { signInErrorKey } from '@/components/auth/ui';
import { hasAllTools } from '@/lib/plans';
import { safeCallbackPath } from '@/lib/redirects';
import { getT } from '@/i18n/server';
import { emailPasswordAvailable, googleSignInAvailable, registrationMode, usernamePasswordAvailable } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { describablePlanOffer } from '@/server/entitlements';
import { getSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  return { title: t('signInTitle'), robots: { index: false, follow: false }, alternates: { languages: { en: '/sign-in', he: '/he/sign-in' } } };
}

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(first(params.callbackURL));
  if (await getSession()) redirect(callbackPath);
  // Better Auth reports failed sign-ins with an error code; show people what
  // happened in plain words (the code itself is not shown).
  const registration = registrationMode();
  const errorKey = signInErrorKey(first(params.error), registration);
  const t = await getT('auth');
  const offer = await describablePlanOffer(getDb);
  return (
    <SignInCard
      freeHasAllTools={offer !== null && hasAllTools(offer.free)}
      callbackPath={callbackPath}
      available={googleSignInAvailable()}
      registration={registration}
      emailPassword={emailPasswordAvailable()}
      usernamePassword={usernamePasswordAvailable()}
      error={errorKey ? t(`errors.${errorKey}`) : null}
    />
  );
}
