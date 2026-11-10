import type { Metadata } from 'next';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Your account · Studio Companion', robots: { index: false, follow: false } };

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// The account page is rendered by the studio in ../layout.tsx (so the tools
// stay alive behind it); this page re-verifies the session for every request.
export default async function ProfilePage() {
  await requireUser('/app/profile');
  return null;
}
