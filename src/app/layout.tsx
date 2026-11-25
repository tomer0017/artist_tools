import type { Metadata, Viewport } from 'next';
import { Frank_Ruhl_Libre } from 'next/font/google';
import { ErrorReporter } from '@/components/common/ErrorReporter';
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
    title: 'SketchyArtLab',
    applicationName: 'SketchyArtLab',
    description,
    authors: [{ name: 'SketchyArtLab' }],
    // Icons come from src/app (favicon.ico in public/, icon.png, apple-icon.png),
    // the social card from src/app/opengraph-image.png, the manifest from
    // src/app/manifest.ts: all made from the official logo by scripts/brand/logo.mjs.
    // The name under the icon on an iPhone home screen. `capable: false` keeps
    // it opening in Safari, as before (Next.js would otherwise make it full screen).
    appleWebApp: { capable: false, title: 'SketchyArtLab' },
    openGraph: { title: 'SketchyArtLab', siteName: 'SketchyArtLab', description, type: 'website' },
    twitter: { card: 'summary_large_image', title: 'SketchyArtLab', description },
  };
}

// Zooming stays possible everywhere (WCAG 1.4.4); only the studio limits it
// (src/app/app/layout.tsx).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The studio's dark background (hsl(240 6% 10%)), for the browser's own bars.
  themeColor: '#18181b',
};

// The display serif of Pro surfaces only (the gilded-frame look: plans, checkout,
// upgrade prompts): Hebrew and Latin, served from this site (font-src 'self').
const display = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], weight: ['500', '700'], variable: '--font-display', display: 'swap' });

// The page's language and direction follow the request (src/i18n/config.ts).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} className={display.variable}>
      <body>
        <ErrorReporter />
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
