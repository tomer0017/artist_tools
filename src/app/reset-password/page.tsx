import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResetPasswordCard } from '@/components/auth/PasswordResetCards';
import { emailPasswordAvailable } from '@/server/auth';

export const metadata: Metadata = {
  title: 'Choose a new password · Studio Companion',
  robots: { index: false, follow: false },
  // The reset token is in this page's address: never send it on in a Referer.
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Opened from the reset email: /reset-password?token=…
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!emailPasswordAvailable()) notFound();
  const token = first((await searchParams).token);
  return <ResetPasswordCard token={token && /^[A-Za-z0-9_-]{8,128}$/.test(token) ? token : null} />;
}
