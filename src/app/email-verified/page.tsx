import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard, Notice } from '@/components/auth/AuthCard';
import { PRIMARY_BUTTON } from '@/components/auth/ui';
import { safeCallbackPath, signInPath } from '@/lib/redirects';
import { getSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  return { title: t('verifiedTitle'), robots: { index: false, follow: false } };
}

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
  const t = await getT('auth');

  return (
    <AuthCard title={error ? t('verified.expiredTitle') : t('verified.title')}>
      {error ? <Notice tone="error">{t('verified.expired')}</Notice> : <Notice tone="success">{t('verified.done')}</Notice>}
      <Link href={signInPath(next)} className={`mt-6 ${PRIMARY_BUTTON}`}>
        {t('signIn')}
      </Link>
    </AuthCard>
  );
}
