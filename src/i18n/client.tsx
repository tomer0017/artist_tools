'use client';

import { IntlProvider } from 'use-intl';
import type { Locale } from '@/lib/locale';
import type { Messages } from './messages/en';

// Gives client components the request's language and messages
// (useTranslations, useLocale). Only the current language's messages are sent.

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: React.ReactNode }) {
  return (
    <IntlProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </IntlProvider>
  );
}
