import { headers } from 'next/headers';
import { SessionKeepAlive } from '@/components/shell/SessionKeepAlive';
import StudioClient from '@/components/shell/StudioClient';
import { AccountProvider } from '@/components/shell/account';
import { I18nProvider } from '@/i18n/client';
import { dirOf } from '@/i18n/config';
import { getRequestLocale, messagesFor } from '@/i18n/server';
import { RETURN_TO_HEADER } from '@/lib/redirects';
import { recordActiveDay } from '@/server/analytics';
import { getDb } from '@/server/db/client';
import { requireStudioAccount } from '@/server/studio-account';

// Depends on who is signed in: always rendered per request, never cached.
export const dynamic = 'force-dynamic';


// Every /app route shares this layout, so the studio (and the tools it keeps
// alive) stays mounted while the URL moves between Home, the tools and the
// account page. The session is verified here on the server before any studio
// code is sent; the pages verify it again on every navigation. The account
// (plan, role, what it may use) is read fresh from the database here and on
// every page (src/server/studio-account.ts); the studio opens only the tools
// it lists (src/components/shell/Studio.tsx).
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const returnTo = (await headers()).get(RETURN_TO_HEADER) ?? '/app';
  const { user, account } = await requireStudioAccount(returnTo);
  await recordActiveDay(getDb(), user.id).catch(() => undefined);
  // The whole studio follows the page language: Home, navigation, the five
  // tools, introductions, the plans and account pages (docs/adr/0009). Inside
  // the tools, canvases and coordinate-based controls stay left to right.
  const locale = await getRequestLocale();
  return (
    <I18nProvider locale={locale} messages={messagesFor(locale)}>
      <div lang={locale} dir={dirOf(locale)} style={{ display: 'contents' }}>
        <AccountProvider initial={account}>
          <SessionKeepAlive />
          <StudioClient />
          {children}
        </AccountProvider>
      </div>
    </I18nProvider>
  );
}
