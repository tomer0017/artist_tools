// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MONGO_STARTUP_TIMEOUT, MONGO_STOP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import {
  BOI_SERIES_URL,
  FX_CONFIRM_MAX_AGE_MS,
  FxFeedError,
  formatRate,
  latestRate,
  parseBoiCsv,
  rateForQuote,
  rateToMicros,
  refreshRates,
  usdToIls,
} from './fx';

// The Bank of Israel's answer, in the format its series database returned on 2026-11-23.
const HEADER = 'SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS';
const row = (date: string, value: string, extra: { series?: string; type?: string; comment?: string } = {}) =>
  `${extra.series ?? 'RER_USD_ILS'},D,USD,ILS,ILS,${extra.type ?? 'OF00'},BOI_MRKT,V,F,Y,0,${extra.comment ?? ''},${date},${value},YP`;
const answer = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('rates and conversion', () => {
  it('reads rates as exact millionths', () => {
    expect(rateToMicros('3.343')).toBe(3_343_000);
    expect(rateToMicros('3.3435')).toBe(3_343_500);
    expect(rateToMicros('4')).toBe(4_000_000);
    for (const bad of ['', 'abc', '3,343', '-3.3', '3.1234567', '3.']) expect(rateToMicros(bad)).toBeNull();
    expect(formatRate(3_343_000)).toBe('3.343');
    expect(formatRate(3_300_000)).toBe('3.300');
    expect(formatRate(3_343_500)).toBe('3.3435');
  });

  it('converts USD cents to agorot, rounded half up to the agora', () => {
    expect(usdToIls(1000, 3_343_000)).toBe(3343); // $10.00 → ₪33.43
    expect(usdToIls(990, 3_343_000)).toBe(3310); // $9.90 → 33.0957 → ₪33.10
    expect(usdToIls(1000, 3_161_000)).toBe(3161); // the same price two weeks earlier
    expect(usdToIls(1, 3_500_000)).toBe(4); // 3.5 agorot → 4
    expect(usdToIls(3, 3_500_000)).toBe(11); // 10.5 → 11
    expect(usdToIls(1, 3_499_999)).toBe(3); // just under half → down
    expect(usdToIls(0, 3_343_000)).toBe(0);
    expect(() => usdToIls(-1, 3_343_000)).toThrow(RangeError);
    expect(() => usdToIls(1.5, 3_343_000)).toThrow(RangeError);
    expect(() => usdToIls(100, 0)).toThrow(RangeError);
  });
});

describe('the Bank of Israel answer', () => {
  it('keeps only representative USD/ILS rates, oldest first', () => {
    const rates = parseBoiCsv(
      answer(
        row('2026-11-23', '3.343'),
        row('2026-11-20', '3.326'),
        row('2026-11-20', '3.330', { type: 'OF01' }), // not a representative rate
        row('2026-11-20', '4.100', { series: 'RER_EUR_ILS' }),
        row('2026-11-19', '3.282', { comment: '"revised, see note"' }), // a quoted comment with a comma
      ),
    );
    expect(rates).toEqual([
      { date: '2026-11-19', rateMicros: 3_282_000 },
      { date: '2026-11-20', rateMicros: 3_326_000 },
      { date: '2026-11-23', rateMicros: 3_343_000 },
    ]);
  });

  it('ignores values that are not plausible rates, and refuses an answer of another shape', () => {
    expect(parseBoiCsv(answer(row('2026-11-23', '0.003'), row('2026-11-24', 'n/a'), row('bad-date', '3.3')))).toEqual([]);
    expect(parseBoiCsv('')).toEqual([]);
    expect(() => parseBoiCsv('<html><body>Service unavailable</body></html>')).toThrow(FxFeedError);
  });
});

describe('stored rates', () => {
  let mongo: TestMongo;
  const NOW = new Date('2026-11-23T13:30:00Z'); // 15:30 in Israel, after today's publication
  const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
  let calls: string[] = [];
  let reply: () => Promise<Response>;
  const fakeFetch = (async (url: string | URL) => {
    calls.push(String(url));
    return reply();
  }) as typeof fetch;
  const ok = (body: string) => () => Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } }));

  beforeAll(async () => {
    mongo = await startTestMongo();
    await migrate(mongo.db);
  }, MONGO_STARTUP_TIMEOUT);
  afterAll(() => mongo?.stop(), MONGO_STOP_TIMEOUT);
  beforeEach(async () => {
    await collections(mongo.db).fxRates.deleteMany({});
    calls = [];
    reply = ok(answer(row('2026-11-20', '3.326'), row('2026-11-23', '3.343')));
  });

  it('asks the Bank of Israel for the last two weeks and stores each rate with its date', async () => {
    const rate = await refreshRates(mongo.db, NOW, fakeFetch);
    expect(rate).toEqual({ date: '2026-11-23', rateMicros: 3_343_000, checkedAt: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${BOI_SERIES_URL}?startperiod=2026-11-09&endperiod=2026-11-24&format=csv`);
    expect(await collections(mongo.db).fxRates.countDocuments()).toBe(2);
    expect(await latestRate(mongo.db)).toEqual({ date: '2026-11-23', rateMicros: 3_343_000, checkedAt: NOW });

    // Asking again adds nothing twice.
    await refreshRates(mongo.db, minutes(20), fakeFetch);
    expect(await collections(mongo.db).fxRates.countDocuments()).toBe(2);
  });

  it('offers a rate only while the Bank of Israel was reached within the hour, asking again after 15 minutes', async () => {
    expect(await rateForQuote(mongo.db, NOW, fakeFetch)).toMatchObject({ date: '2026-11-23', rateMicros: 3_343_000 });
    expect(calls).toHaveLength(1);
    // Within 15 minutes the stored check is reused.
    expect(await rateForQuote(mongo.db, minutes(10), fakeFetch)).toMatchObject({ rateMicros: 3_343_000 });
    expect(calls).toHaveLength(1);
    // Later it asks again; when the Bank of Israel cannot be reached the last check still counts within the hour…
    reply = () => Promise.reject(new TypeError('fetch failed'));
    expect(await rateForQuote(mongo.db, minutes(40), fakeFetch)).toMatchObject({ rateMicros: 3_343_000 });
    expect(calls).toHaveLength(2);
    // …and not after it: no ILS price rather than an old one.
    expect(await rateForQuote(mongo.db, new Date(NOW.getTime() + FX_CONFIRM_MAX_AGE_MS + 60_000), fakeFetch)).toBeNull();
    // Reachable again: the newest published rate is used.
    reply = ok(answer(row('2026-11-23', '3.343'), row('2026-11-24', '3.351')));
    expect(await rateForQuote(mongo.db, minutes(90), fakeFetch)).toMatchObject({ date: '2026-11-24', rateMicros: 3_351_000 });
  });

  it('never offers a rate before the first successful check', async () => {
    reply = () => Promise.resolve(new Response('Service unavailable', { status: 503 }));
    expect(await rateForQuote(mongo.db, NOW, fakeFetch)).toBeNull();
    await expect(refreshRates(mongo.db, NOW, fakeFetch)).rejects.toBeInstanceOf(FxFeedError);
    reply = ok('<html>maintenance</html>');
    await expect(refreshRates(mongo.db, NOW, fakeFetch)).rejects.toBeInstanceOf(FxFeedError);
    reply = ok(answer(row('2026-11-23', 'n/a')));
    await expect(refreshRates(mongo.db, NOW, fakeFetch)).rejects.toThrow('no representative USD/ILS rate');
    expect(await collections(mongo.db).fxRates.countDocuments()).toBe(0);
  });

  it('records a rate the Bank of Israel later reports differently, keeping the earlier value', async () => {
    await refreshRates(mongo.db, NOW, fakeFetch);
    reply = ok(answer(row('2026-11-20', '3.326'), row('2026-11-23', '3.345')));
    await refreshRates(mongo.db, minutes(30), fakeFetch);
    expect(await collections(mongo.db).fxRates.findOne({ _id: 'USD_ILS:2026-11-23' })).toMatchObject({
      rateMicros: 3_345_000,
      previousRateMicros: 3_343_000,
      revisedAt: minutes(30),
    });
  });
});
