import { AccountSync } from '@/components/shell/account';
import { requireStudioAccount } from '@/server/studio-account';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Home (the Tool Hub) is rendered by the studio in ./layout.tsx; this page
// re-verifies the session for every request that reaches it and sends the
// account as it is now (which tools are open to it).
export default async function StudioHomePage() {
  const { account } = await requireStudioAccount('/app');
  return <AccountSync account={account} />;
}
