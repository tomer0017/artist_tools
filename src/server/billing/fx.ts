import 'server-only';
import type { Db } from 'mongodb';
import { collections } from '@/server/db/collections';
import { log } from '@/server/log';

// ─── USD → ILS at the Bank of Israel's representative rate ────────────────────
// Pro has one monthly price, in USD (Admin → Pricing). Someone whose currency
// preference is ILS is offered that price converted at the latest
// representative rate the Bank of Israel has published, rounded half up to
// the agora. Once they subscribe, that amount is theirs for the life of the
// subscription: it never follows later rates.
//
// Rates come from the Bank of Israel's series database (series RER_USD_ILS,
// representative rates only: DATA_TYPE OF00). They are published on business
// days soon after 15:15 (12:15 on Fridays and holiday eves), and each is kept
// with its publication date as an integer number of millionths (no floats in
// money). A stored rate counts as the latest only while the Bank of Israel was
// reached within the last hour; otherwise no ILS price is offered at all,
// rather than an old one.

export const FX_PAIR = 'USD_ILS' as const;
export const BOI_SERIES_URL = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS';
/** How recently the Bank of Israel must have been reached for its newest rate to count as the latest. */
export const FX_CONFIRM_MAX_AGE_MS = 60 * 60 * 1000;
/** A check younger than this is reused rather than asking the Bank of Israel again. */
export const FX_REFRESH_AFTER_MS = 15 * 60 * 1000;
/** Days of history read on each check: covers weekends and the longest holiday breaks. */
const LOOKBACK_DAYS = 14;
const TIMEOUT_MS = 8000;
const MAX_ANSWER_CHARS = 200_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MICROS = 1_000_000;
/** Outside this band a value is treated as a broken answer, not a rate. */
const SANE_MICROS = { min: 1 * MICROS, max: 10 * MICROS };

export interface PublishedRate {
  /** Publication date in Israel, YYYY-MM-DD. */
  date: string;
  /** Shekels per dollar in millionths. */
  rateMicros: number;
}

export interface StoredRate extends PublishedRate {
  /** The last time the Bank of Israel was reached and this was its newest rate. */
  checkedAt: Date | null;
}

export class FxFeedError extends Error {}

/** "3.343" → 3_343_000; null for anything but a plain decimal with up to six decimals. */
export function rateToMicros(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * MICROS + Number((match[2] ?? '').padEnd(6, '0'));
}

/** 3_343_000 → "3.343": as published, with at least three decimals. */
export function formatRate(rateMicros: number): string {
  const whole = Math.floor(rateMicros / MICROS);
  const decimals = String(rateMicros % MICROS).padStart(6, '0').replace(/0+$/, '').padEnd(3, '0');
  return `${whole}.${decimals}`;
}

/** USD cents → agorot at a rate in millionths, rounded half up to the agora (exact integer arithmetic). */
export function usdToIls(usdMinor: number, rateMicros: number): number {
  if (!Number.isSafeInteger(usdMinor) || usdMinor < 0 || !Number.isSafeInteger(rateMicros) || rateMicros <= 0) {
    throw new RangeError('amount and rate must be non-negative integers');
  }
  const scale = BigInt(MICROS);
  const product = BigInt(usdMinor) * BigInt(rateMicros);
  const whole = product / scale;
  const rest = product % scale;
  return Number(rest * 2n >= scale ? whole + 1n : whole);
}

/** One CSV line into cells (fields may be quoted, with "" for a quote). */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/**
 * The USD/ILS representative rates in a Bank of Israel series-database CSV
 * answer, oldest first. Rows of other series or data types are ignored, as
 * are values that are not plausible rates. Throws when the answer does not
 * have the expected columns.
 */
export function parseBoiCsv(csv: string): PublishedRate[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const header = csvCells(lines[0]);
  const at = (name: string) => header.indexOf(name);
  const [series, type, period, value] = [at('SERIES_CODE'), at('DATA_TYPE'), at('TIME_PERIOD'), at('OBS_VALUE')];
  if ([series, type, period, value].some((index) => index < 0)) throw new FxFeedError('the answer does not have the expected columns');
  const byDate = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const cells = csvCells(line);
    if (cells[series] !== 'RER_USD_ILS' || cells[type] !== 'OF00') continue;
    const date = cells[period] ?? '';
    const micros = rateToMicros(cells[value] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || micros === null || micros < SANE_MICROS.min || micros > SANE_MICROS.max) {
      log.warn('fx.value_ignored', { date, value: (cells[value] ?? '').slice(0, 20) });
      continue;
    }
    byDate.set(date, micros);
  }
  return [...byDate]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, rateMicros]) => ({ date, rateMicros }));
}

const isoDate = (at: Date) => at.toISOString().slice(0, 10);

/** The representative rates of the last two weeks, from the Bank of Israel (oldest first). */
export async function fetchPublishedRates(now: Date, fetchImpl: typeof fetch = fetch): Promise<PublishedRate[]> {
  // The end date runs a day ahead: Israel's date can be ahead of UTC's.
  const url = `${BOI_SERIES_URL}?startperiod=${isoDate(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS))}&endperiod=${isoDate(new Date(now.getTime() + DAY_MS))}&format=csv`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'text/csv', 'user-agent': 'StudioCompanion/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new FxFeedError(`the Bank of Israel could not be reached (${error instanceof Error ? error.name : 'error'})`);
  }
  if (!response.ok) throw new FxFeedError(`the Bank of Israel answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_ANSWER_CHARS) throw new FxFeedError('the answer is larger than expected');
  const rates = parseBoiCsv(text);
  if (rates.length === 0) throw new FxFeedError('the answer has no representative USD/ILS rate');
  return rates;
}

/**
 * Ask the Bank of Israel for its recent rates and store them. New dates are
 * added; a date it now reports differently is updated and marked as revised
 * (a subscription keeps the rate it was priced with either way). The newest
 * rate is marked as checked now. Throws FxFeedError when nothing usable came
 * back, leaving what is stored as it was.
 */
export async function refreshRates(db: Db, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<StoredRate> {
  const rates = await fetchPublishedRates(now, fetchImpl);
  const { fxRates } = collections(db);
  const ids = rates.map((r) => `${FX_PAIR}:${r.date}`);
  const known = new Map((await fxRates.find({ _id: { $in: ids } }, { projection: { rateMicros: 1 } }).toArray()).map((d) => [d._id, d.rateMicros]));
  for (const rate of rates) {
    const _id = `${FX_PAIR}:${rate.date}`;
    const before = known.get(_id);
    if (before === undefined) {
      await fxRates.updateOne(
        { _id },
        { $setOnInsert: { pair: FX_PAIR, date: rate.date, rateMicros: rate.rateMicros, source: 'boi', fetchedAt: now } },
        { upsert: true },
      );
    } else if (before !== rate.rateMicros) {
      await fxRates.updateOne({ _id }, { $set: { rateMicros: rate.rateMicros, previousRateMicros: before, revisedAt: now } });
      log.warn('fx.rate_revised', { date: rate.date, before, after: rate.rateMicros });
    }
  }
  const newest = rates[rates.length - 1];
  await fxRates.updateOne({ _id: `${FX_PAIR}:${newest.date}` }, { $set: { checkedAt: now } });
  return { ...newest, checkedAt: now };
}

/** The newest stored rate, with when the Bank of Israel last confirmed it (null before any check). */
export async function latestRate(db: Db): Promise<StoredRate | null> {
  const doc = await collections(db).fxRates.findOne({ pair: FX_PAIR }, { sort: { date: -1 } });
  return doc ? { date: doc.date, rateMicros: doc.rateMicros, checkedAt: doc.checkedAt ?? null } : null;
}

/** Whether a stored rate is known to be the latest: the Bank of Israel was reached within the hour. */
export const rateConfirmed = (rate: StoredRate | null, now: Date): rate is StoredRate =>
  rate !== null && rate.checkedAt !== null && now.getTime() - rate.checkedAt.getTime() <= FX_CONFIRM_MAX_AGE_MS && rate.checkedAt.getTime() <= now.getTime() + 60_000;

/** One check of the Bank of Israel at a time in this process; others wait for its answer. */
let inFlight: Promise<StoredRate> | null = null;

/**
 * The rate to lock an ILS price with: the latest published, confirmed with
 * the Bank of Israel within the hour (asking it again when the last check is
 * over 15 minutes old). Null when that cannot be confirmed: an ILS price is
 * then not offered, never priced at an older rate.
 */
export async function rateForQuote(db: Db, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<StoredRate | null> {
  let rate = await latestRate(db);
  if (!rate?.checkedAt || now.getTime() - rate.checkedAt.getTime() > FX_REFRESH_AFTER_MS) {
    try {
      inFlight ??= refreshRates(db, now, fetchImpl).finally(() => {
        inFlight = null;
      });
      rate = await inFlight;
    } catch (error) {
      log.warn('fx.refresh_failed', { error: error instanceof Error ? error.message : 'unknown error' });
    }
  }
  return rateConfirmed(rate, now) ? rate : null;
}
