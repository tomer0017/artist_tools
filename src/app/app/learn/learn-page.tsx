import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountSync } from '@/components/shell/account';
import { requireStudioAccount } from '@/server/studio-account';

// Every Learn page (ADR-0018). Learn is a studio view (src/components/learn),
// so the tools stay alive behind it; each page verifies the session for every
// request that reaches it and sends the account as it is now. An account that
// is not shown Learn at all (no published plan offers a Learn module, and it
// is not an admin) is sent Home, as for an address that does not exist.
// Learn's content is never in a page: the Learn view asks the Learn API, which
// authorizes every request (src/app/api/learn).

export const learnMetadata: Metadata = { title: 'Learn · SketchyArtLab', robots: { index: false, follow: false } };

export async function LearnPage({ path }: { path: string }) {
  const { account } = await requireStudioAccount(path);
  if (!account.learn.visible) redirect('/app');
  return <AccountSync account={account} />;
}
