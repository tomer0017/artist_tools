import type { Viewport } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import StudioClient from '@/components/shell/StudioClient';
import { I18nProvider } from '@/i18n/client';
import { dirOf } from '@/i18n/config';
import { getRequestLocale, messagesFor } from '@/i18n/server';
import { RETURN_TO_HEADER, signInPath } from '@/lib/redirects';
import { getAccountSummary } from '@/server/account';
import { recordActiveDay } from '@/server/analytics';
import { emailPasswordAvailable } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { requireUser } from '@/server/session';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';

// The studio keeps the page at its own scale: the canvas tools handle pinch
// and pan themselves, and iOS would otherwise zoom into small inputs (a scale
// length) and stay zoomed. A known accessibility limitation (it blocks page
// zoom on Android), to lift once the tools' inputs are 16 px on phones
// (docs/accessibility/README.md).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

// Every /app route shares this layout, so the studio (and the tools it keeps
// alive) stays mounted while the URL moves between Home, the tools and the
// account page. The session is verified here on the server before any studio
// code is sent; the pages verify it again on every navigation. The account
// (plan, role, what it includes) is read fresh from the database.
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const returnTo = (await headers()).get(RETURN_TO_HEADER) ?? '/app';
  const user = await requireUser(returnTo);
  const summary = await getAccountSummary(getDb(), toObjectId(user.id)!, { emailPasswordEnabled: emailPasswordAvailable() });
  if (!summary) redirect(signInPath(returnTo));
  await recordActiveDay(getDb(), user.id).catch(() => undefined);
  // The studio's frame (Home, navigation, introductions, plans and account
  // pages) follows the page language. Each tool's own workspace stays English
  // and left to right until it is translated (ToolFrame, docs/adr/0009).
  const locale = await getRequestLocale();
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <div lang={locale} dir={dirOf(locale)} style={{ display: 'contents' }}>
        <StudioClient account={summary.account} />
        {children}
      </div>
    </I18nProvider>
  );
}
