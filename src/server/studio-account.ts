import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { signInPath } from '@/lib/redirects';
import { getAccountSummary } from '@/server/account';
import { emailPasswordAvailable, usernamePasswordAvailable } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { requireUser } from '@/server/session';

// The account as every studio page sends it: the session verified on the
// server, then the account (role, plan in force, what it may use, what each
// plan includes) read from the database. The layout sends it with the first
// page load; each page sends it again with every navigation inside the studio
// (src/components/shell/account.tsx, AccountSync), so a plan change or a
// newly published catalog reaches an open studio on its next step without a
// request of its own.

const summaryOf = cache(async (userId: string) =>
  getAccountSummary(getDb(), toObjectId(userId)!, {
    emailPasswordEnabled: emailPasswordAvailable(),
    usernamePasswordEnabled: usernamePasswordAvailable(),
  }),
);

/** The signed-in person's account, read fresh (once per request), or a redirect to sign in and back to `returnTo`. */
export async function requireStudioAccount(returnTo: string) {
  const user = await requireUser(returnTo);
  const summary = await summaryOf(user.id);
  if (!summary) redirect(signInPath(returnTo));
  return { user, ...summary };
}
