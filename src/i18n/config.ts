import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/locale';

// ─── Languages (docs/adr/0009) ────────────────────────────────────────────────
// English and Hebrew; Spanish and French later. Which language a request is
// shown in: an explicit /he/… public URL, else the signed-in person's saved
// preference, else the language cookie (set by the language switch), else the
// browser's Accept-Language, else English. The studio never uses a URL prefix,
// so tool links stay the same in every language. Canvases stay left-to-right.

/** The cookie the language switch sets (one year). */
export const LOCALE_COOKIE = 'sc_locale';
/** Request header set by the proxy for /he/… pages (never trusted from the client). */
export const LOCALE_HEADER = 'x-studio-locale';

export const dirOf = (locale: Locale): 'ltr' | 'rtl' => (locale === 'he' ? 'rtl' : 'ltr');

/** Public pages also served under a language prefix, for search engines and sharing: /he, /he/pricing… */
export const PREFIXABLE_PATHS = ['/', '/pricing', '/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/email-verified'] as const;

/** The public URL of `path` in `locale` (English has no prefix). */
export const localizedPath = (path: string, locale: Locale): string => (locale === DEFAULT_LOCALE ? path : `/${locale}${path === '/' ? '' : path}`);

/** The first supported language in an Accept-Language header, by preference. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { lang: tag.split('-')[0] === 'iw' ? 'he' : tag.split('-')[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return (ranked.find((x) => isLocale(x.lang))?.lang as Locale | undefined) ?? null;
}
