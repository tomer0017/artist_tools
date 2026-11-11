'use server';

import { cookies } from 'next/headers';
import { isLocale } from '@/lib/locale';
import { LOCALE_COOKIE } from '@/i18n/config';
import { updateProfile } from '@/server/account-management';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { getSession } from '@/server/session';

/** Remember a language choice: in a cookie for this browser, and on the account when signed in. */
export async function chooseLocale(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  const session = await getSession();
  const userId = session ? toObjectId(session.user.id) : null;
  if (userId) await updateProfile(getDb(), userId, { locale });
  return { ok: true };
}
