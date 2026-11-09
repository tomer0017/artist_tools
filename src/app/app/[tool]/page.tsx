import { redirect } from 'next/navigation';
import { TOOL_SLUGS } from '@/components/shell/tools';
import { requireUser } from '@/server/session';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Each tool is rendered by the studio in ../layout.tsx; this page decides which
// tool URLs exist (unknown tools fall back to Home, as they always have) and
// re-verifies the session for every request that reaches it.
export default async function ToolPage({ params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!TOOL_SLUGS.includes(tool)) redirect('/app');
  await requireUser(`/app/${tool}`);
  return null;
}
