import { requireUser } from '@/server/session';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Home (the Tool Hub) is rendered by the studio in ./layout.tsx; this page only
// re-verifies the session for every request that reaches it.
export default async function StudioHomePage() {
  await requireUser('/app');
  return null;
}
