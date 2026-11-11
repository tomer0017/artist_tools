import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { notFound } from 'next/navigation';
import { ForgotPasswordCard } from '@/components/auth/PasswordResetCards';
import { emailPasswordAvailable } from '@/server/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  return { title: t('forgotTitle'), robots: { index: false, follow: false }, alternates: { languages: { en: '/forgot-password', he: '/he/forgot-password' } } };
}

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  if (!emailPasswordAvailable()) notFound();
  return <ForgotPasswordCard />;
}
