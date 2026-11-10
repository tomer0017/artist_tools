import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import StudioClient from '@/components/shell/StudioClient';
import { RETURN_TO_HEADER, signInPath } from '@/lib/redirects';
import { getAccountSummary } from '@/server/account';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { requireUser } from '@/server/session';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// Every /app route shares this layout, so the studio (and the tools it keeps
// alive) stays mounted while the URL moves between Home, the tools and the
// account page. The session is verified here on the server before any studio
// code is sent; the pages verify it again on every navigation. The account
// (plan, role, what it includes) is read fresh from the database.
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const returnTo = (await headers()).get(RETURN_TO_HEADER) ?? '/app';
  const user = await requireUser(returnTo);
  const summary = await getAccountSummary(getDb(), toObjectId(user.id)!);
  if (!summary) redirect(signInPath(returnTo));
  return (
    <>
      <StudioClient account={summary.account} />
      {children}
    </>
  );
}
