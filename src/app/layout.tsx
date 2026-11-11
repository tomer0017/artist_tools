import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/i18n/client';
import { dirOf } from '@/i18n/config';
import { getRequestLocale, getT, messagesFor } from '@/i18n/server';
import { authConfig } from '@/server/env';
import '@/index.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT('meta');
  const description = t('siteDescription');
  return {
    // Absolute URLs for alternates (hreflang) and social cards.
    metadataBase: new URL(authConfig().baseURL),
    title: 'Studio Companion',
    description,
    authors: [{ name: 'Studio Companion' }],
    openGraph: { title: 'Studio Companion', description, type: 'website' },
    twitter: { card: 'summary', title: 'Studio Companion', description },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

// The page's language and direction follow the request (src/i18n/config.ts).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
