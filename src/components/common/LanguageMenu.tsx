'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LOCALES, LOCALE_NAMES, isLocale } from '@/lib/locale';
import { LOCALE_COOKIE, dirOf } from '@/i18n/config';
import { chooseLocale } from '@/app/locale-actions';

// 🌐 in the studio's header: English | עברית. The choice is kept exactly as the
// public pages' language switch keeps it (on the account when signed in, and
// in the cookie); then the studio is rendered again in place (router.refresh):
// the words and the page's direction change at once, without a reload, so
// nothing open in the studio is lost.
export function LanguageMenu() {
  const locale = useLocale();
  const t = useTranslations('language');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (next: string) => {
    if (next === locale || !isLocale(next)) return;
    startTransition(async () => {
      await chooseLocale(next).catch(() => undefined);
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      router.refresh();
    });
  };

  return (
    // Radix needs the page's direction for its alignment and arrow keys.
    <DropdownMenu dir={dirOf(isLocale(locale) ? locale : 'en')}>
      <DropdownMenuTrigger
        aria-label={t('choose')}
        title={t('label')}
        disabled={pending}
        data-language-menu=""
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/60 text-muted-foreground ring-1 ring-border/70 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <Globe className="h-[18px] w-[18px]" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t('label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={choose}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l} className="min-h-10 cursor-pointer">
              {LOCALE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
