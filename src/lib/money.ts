import type { Currency } from './locale';

// Money is an integer amount in minor units plus its currency (docs/adr/0007):
// no floats in stored amounts, no exchange-rate conversion.

/** Digits after the decimal point for a currency (both current ones use 2). */
export const minorDigits = (currency: Currency) => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;

/** "9.90" (major units, as typed) → 990; null for anything that is not a valid amount. */
export function toMinor(input: string, currency: Currency): number | null {
  const digits = minorDigits(currency);
  const match = new RegExp(`^\\s*(\\d{1,7})(?:[.,](\\d{1,${digits}}))?\\s*$`).exec(input);
  if (!match) return null;
  return Number(match[1]) * 10 ** digits + Number((match[2] ?? '').padEnd(digits, '0') || 0);
}

/** 990 → "9.90", for editing. */
export const fromMinor = (amountMinor: number, currency: Currency) => (amountMinor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency));

export const formatMoney = (amountMinor: number, currency: Currency, locale = 'en') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 10 ** minorDigits(currency));
