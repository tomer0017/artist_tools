import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { createTranslator } from 'use-intl/core';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/locale';
import { getDb } from '@/server/db/client';
import { collections, toObjectId } from '@/server/db/collections';
import { getSession } from '@/server/session';
import { LOCALE_COOKIE, LOCALE_HEADER, localeFromAcceptLanguage } from './config';
import { en, type Messages } from './messages/en';
import { he } from './messages/he';

const MESSAGES: Record<Locale, Messages> = { en, he };

export const messagesFor = (locale: Locale): Messages => MESSAGES[locale];

/** The language of this request (see ./config.ts for the order). Cached per request. */
export const getRequestLocale = cache(async (): Promise<Locale> => {
  const requestHeaders = await headers();
  const forced = requestHeaders.get(LOCALE_HEADER);
  if (isLocale(forced)) return forced;
  const session = await getSession().catch(() => null);
  const userId = session ? toObjectId(session.user.id) : null;
  if (userId) {
    const user = await collections(getDb()).users.findOne({ _id: userId }, { projection: { locale: 1 } });
    if (isLocale(user?.locale)) return user.locale;
  }
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(requestHeaders.get('accept-language')) ?? DEFAULT_LOCALE;
});

/** A translator for server components and metadata: `(await getT('auth'))('signIn')`. */
export async function getT<N extends keyof Messages>(namespace: N) {
  const locale = await getRequestLocale();
  return createTranslator({ locale, messages: messagesFor(locale), namespace });
}
