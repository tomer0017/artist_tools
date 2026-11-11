'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/locale';
import { LOCALE_COOKIE, PREFIXABLE_PATHS, localizedPath } from '@/i18n/config';
import { chooseLocale } from '@/app/locale-actions';

// English | עברית. Remembers the choice (cookie, and the account when signed
// in), then reloads the page in that language: public pages move to their
// /he address and back, other pages reload where they are.

export function LanguageSwitch({ className = '' }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('language');
  const [pending, startTransition] = useTransition();

  const choose = (next: Locale) =>
    startTransition(async () => {
      if (next === locale) return;
      // The server saves the choice on the account when signed in; then the
      // browser writes the cookie itself, last, so nothing can overwrite it
      // before the page reloads (the cookie holds only the language).
      await chooseLocale(next).catch(() => undefined);
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      const path = window.location.pathname.replace(/^\/he(?=\/|$)/, '') || '/';
      const target = (PREFIXABLE_PATHS as readonly string[]).includes(path) ? localizedPath(path, next) : path;
      window.location.assign(target + window.location.search);
    });

  return (
    <div role="group" aria-label={t('choose')} className={`inline-flex items-center gap-0.5 rounded-lg border border-border bg-card/70 p-0.5 text-xs ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          disabled={pending}
          onClick={() => choose(l)}
          className={`rounded-md px-2 py-1 font-medium transition-colors disabled:opacity-60 ${l === locale ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {LOCALE_NAMES[l]}
        </button>
      ))}
    </div>
  );
}
