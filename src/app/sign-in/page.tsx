import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SignInCard from '@/components/auth/SignInCard';
import { safeCallbackPath } from '@/lib/redirects';
import { emailPasswordAvailable, googleSignInAvailable, registrationMode } from '@/server/auth';
import { getSession } from '@/server/session';

export const metadata: Metadata = {
  title: 'Sign in or sign up · Studio Companion',
  robots: { index: false, follow: false },
};

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Better Auth reports failed sign-ins with an error code; show people what
// happened in plain words (the code itself is not shown).
const MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. You can try again whenever you are ready.',
  // A Google sign-in for an address that already has an account another way: never merged automatically.
  account_not_linked:
    'An account with this email address already exists. Sign in the way you signed up (with your password, or with the Google account you used); you can then connect this Google account on your account page.',
  not_invited: 'This Google account cannot create an account here yet. Studio Companion is invite-only while we test it, and Google must have verified the address.',
  unable_to_create_user: 'This Google account cannot create an account here yet. Studio Companion is invite-only while we test it.',
  unable_to_create_session: 'This account cannot sign in right now. Please contact support if you think this is a mistake.',
};
const GENERIC = 'Sign-in did not complete. Please try again.';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(first(params.callbackURL));
  if (await getSession()) redirect(callbackPath);
  const error = first(params.error);
  return (
    <SignInCard
      callbackPath={callbackPath}
      available={googleSignInAvailable()}
      registration={registrationMode()}
      emailPassword={emailPasswordAvailable()}
      error={error ? (MESSAGES[error] ?? GENERIC) : null}
    />
  );
}
