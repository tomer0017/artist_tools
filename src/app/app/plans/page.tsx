import type { Metadata } from 'next';
import { AccountSync } from '@/components/shell/account';
import { requireStudioAccount } from '@/server/studio-account';

export const metadata: Metadata = { title: 'Plans · Studio Companion', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// The plans view is rendered by the studio in ../layout.tsx (so the tools stay
// alive behind it); this page re-verifies the session for every request and
// sends the account (and what each plan includes) as it is now.
export default async function PlansPage() {
  const { account } = await requireStudioAccount('/app/plans');
  return <AccountSync account={account} />;
}
