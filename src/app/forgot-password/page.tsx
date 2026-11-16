import type { Metadata } from 'next';
import { localizedPath } from '@/i18n/config';
import { addressLocale, getT } from '@/i18n/server';
import { redirect } from 'next/navigation';
import { ForgotPasswordCard } from '@/components/auth/PasswordResetCards';
import { emailPasswordAvailable } from '@/server/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  return { title: t('forgotTitle'), robots: { index: false, follow: false }, alternates: { languages: { en: '/forgot-password', he: '/he/forgot-password' } } };
}

export const dynamic = 'force-dynamic';

// Where passwords are off there is nothing to reset: sign-in instead.
export default async function ForgotPasswordPage() {
  if (!emailPasswordAvailable()) redirect(localizedPath('/sign-in', await addressLocale()));
  return <ForgotPasswordCard />;
}
