import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SignInCard from '@/components/auth/SignInCard';
import { safeCallbackPath } from '@/lib/redirects';
import { getSession } from '@/server/session';

export const metadata: Metadata = {
  title: 'Sign in · Studio Companion',
  robots: { index: false, follow: false },
};

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Better Auth reports failed sign-ins with an error code; show people what
// happened in plain words (the code itself is not shown).
const MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled. You can try again whenever you are ready.',
  account_not_linked: 'This Google account cannot be used to sign in here. Please use the Google account you signed up with.',
  unable_to_create_session: 'This account cannot sign in right now. Please contact support if you think this is a mistake.',
};
const GENERIC = 'Sign-in did not complete. Please try again.';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(first(params.callbackURL));
  if (await getSession()) redirect(callbackPath);
  const error = first(params.error);
  return <SignInCard callbackPath={callbackPath} error={error ? (MESSAGES[error] ?? GENERIC) : null} />;
}
