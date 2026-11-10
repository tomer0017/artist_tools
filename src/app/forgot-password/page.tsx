import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ForgotPasswordCard } from '@/components/auth/PasswordResetCards';
import { emailPasswordAvailable } from '@/server/auth';

export const metadata: Metadata = {
  title: 'Reset your password · Studio Companion',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  if (!emailPasswordAvailable()) notFound();
  return <ForgotPasswordCard />;
}
