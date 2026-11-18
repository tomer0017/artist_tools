import { redirect } from 'next/navigation';
import { AccountSync } from '@/components/shell/account';
import { TOOL_SLUGS } from '@/components/shell/tools';
import { requireStudioAccount } from '@/server/studio-account';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Each tool is rendered by the studio in ../layout.tsx; this page decides which
// tool URLs exist (unknown tools fall back to Home, as they always have),
// re-verifies the session for every request that reaches it, and sends the
// account as the database has it now — direct visits, reloads and every
// navigation inside the studio — so the studio opens the tool only if the
// account may use it, and otherwise shows that it is locked.
export default async function ToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!TOOL_SLUGS.includes(tool)) redirect('/app');
  const { account } = await requireStudioAccount(`/app/${tool}`);
  return <AccountSync account={account} />;
}
