// Languages and currencies a person can choose (account page). The interface
// is English until Phase 3 adds the Hebrew translation; the choice is saved
// now so it applies from then on. Adding one is adding it here.

export const LOCALES = ['en', 'he'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language named in itself, as language pickers show it. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', he: 'עברית' };

export const CURRENCIES = ['USD', 'ILS'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'USD';

export const CURRENCY_NAMES: Record<Currency, string> = { USD: 'US dollar ($)', ILS: 'Israeli new shekel (₪)' };

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
export const isCurrency = (value: unknown): value is Currency => typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
