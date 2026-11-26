import type { Metadata } from 'next';
import { AccountSync } from '@/components/shell/account';
import { requireStudioAccount } from '@/server/studio-account';

export const metadata: Metadata = { title: 'Your account · SketchyArtLab', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// The account page is rendered by the studio in ../layout.tsx (so the tools
// stay alive behind it); this page re-verifies the session for every request
// and sends the account as it is now.
export default async function ProfilePage() {
  const { account } = await requireStudioAccount('/app/profile');
  return <AccountSync account={account} />;
}
