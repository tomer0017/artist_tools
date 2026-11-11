import type { Messages } from './messages/en';
import type { Locale } from '@/lib/locale';

// Typed message keys and locales for useTranslations / createTranslator.
declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
