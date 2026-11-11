// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { localeFromAcceptLanguage, localizedPath } from './config';
import { en } from './messages/en';
import { he } from './messages/he';
import { mailTemplates } from '@/server/mail/templates';

// Every language has every message, each one is valid ICU, and translations
// keep the same placeholders and link tags as the English source.

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

/** Placeholder names and tag names a message uses, e.g. {email}, {count, plural, …} and <link> (not the words inside plural branches). */
const tokens = (message: string) => [...message.matchAll(/\{(\w+)\s*[,}]|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort();

const english = leaves(en as unknown as Tree);
const hebrew = leaves(he as unknown as Tree);

describe('messages', () => {
  it('Hebrew has exactly the English keys, none empty', () => {
    expect([...hebrew.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of hebrew) expect(value.trim(), key).not.toBe('');
  });

  it('every message is valid ICU in its language', () => {
    for (const [locale, messages] of [['en', english], ['he', hebrew]] as const) {
      for (const [key, message] of messages) {
        expect(() => new IntlMessageFormat(message, locale), `${locale}:${key}`).not.toThrow();
      }
    }
  });

  it('translations keep the placeholders and link tags of the English message', () => {
    for (const [key, message] of english) expect(tokens(hebrew.get(key)!), key).toEqual(tokens(message));
  });
});

describe('choosing a language', () => {
  it('reads Accept-Language by preference, and treats the old "iw" code as Hebrew', () => {
    expect(localeFromAcceptLanguage('he-IL,he;q=0.9,en-US;q=0.8')).toBe('he');
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9,he;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,he;q=0.5,en;q=0.4')).toBe('he');
    expect(localeFromAcceptLanguage('iw')).toBe('he');
    expect(localeFromAcceptLanguage('de,he;q=0')).toBeNull();
    expect(localeFromAcceptLanguage('')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it('builds public addresses per language (English has no prefix)', () => {
    expect(localizedPath('/', 'he')).toBe('/he');
    expect(localizedPath('/pricing', 'he')).toBe('/he/pricing');
    expect(localizedPath('/pricing', 'en')).toBe('/pricing');
  });
});

describe('account emails', () => {
  it('are written in the account language, right to left in Hebrew', () => {
    const hebrewMail = mailTemplates('he').verifyEmail('אדה לאבלייס', 'https://example.com/verify?token=x');
    expect(hebrewMail.subject).toBe('אישור כתובת האימייל');
    expect(hebrewMail.text.startsWith('שלום אדה,')).toBe(true);
    expect(hebrewMail.html).toContain('<html lang="he" dir="rtl">');
    // The link itself stays left to right.
    expect(hebrewMail.html).toContain('<span dir="ltr"');
    const english = mailTemplates('en').verifyEmail('Ada Lovelace', 'https://example.com/verify?token=x');
    expect(english.subject).toBe('Confirm your email address');
    expect(english.html).toContain('<html lang="en" dir="ltr">');
    // Anything unknown falls back to English.
    expect(mailTemplates('fr').resetPassword(null, 'https://example.com').subject).toBe('Reset your password');
  });
});
