// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { cleanPath, fingerprint, listErrors, recordError, scrub } from './error-reports';

describe('error reports keep nothing personal', () => {
  it('removes email addresses, query strings and token-like strings', () => {
    expect(scrub('Failed for ada@example.com at https://site.test/reset?token=abc123&x=1#frag')).toBe('Failed for [email] at https://site.test/reset');
    expect(scrub('GET /api/x?code=secret&state=y failed')).toBe('GET /api/x?code=[…]&state=[…] failed');
    expect(scrub('session sc_9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddcc expired')).toBe('session [token] expired');
    expect(scrub('TypeError: x is undefined')).toBe('TypeError: x is undefined');
  });

  it('keeps paths without queries and folds ids', () => {
    expect(cleanPath('/admin/users/6af25c8bce0d3b3d32fcc005?tab=1#x')).toBe('/admin/users/[id]');
    expect(cleanPath('/app/measure')).toBe('/app/measure');
  });

  it('groups the same error from the same code, whatever the numbers and line numbers', () => {
    const a = fingerprint('client', 'Index 3 out of range', 'Error\n    at render (app.js:10:20)');
    const b = fingerprint('client', 'Index 7 out of range', 'Error\n    at render (app.js:11:5)');
    const c = fingerprint('client', 'Index 7 out of range', 'Error\n    at other (app.js:11:5)');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(fingerprint('server', 'Index 3 out of range', 'Error\n    at render (app.js:10:20)')).not.toBe(a);
  });
});

describe('recording', () => {
  let mongo: TestMongo;
  beforeAll(async () => {
    mongo = await startTestMongo();
    await migrate(mongo.db);
  }, MONGO_STARTUP_TIMEOUT);
  afterAll(async () => mongo?.stop());

  it('counts a group, keeps up to ten pages, releases and browsers, and expires groups after 30 days', async () => {
    const db = mongo.db;
    const first = new Date('2026-11-01T10:00:00Z');
    for (let i = 0; i < 12; i++) {
      await recordError(
        db,
        { source: 'client', message: `Cannot read x of undefined (${i})`, stack: 'TypeError\n    at draw (tool.js:1:2)', path: `/app/page-${i}?q=1`, release: i < 2 ? 'aaa1111' : 'bbb2222', browser: 'Safari on iPhone' },
        new Date(first.getTime() + i * 60_000),
      );
    }
    const [group] = await listErrors(db);
    expect(group).toMatchObject({ source: 'client', count: 12, releases: ['aaa1111', 'bbb2222'], browsers: ['Safari on iPhone'], firstSeen: first });
    expect(group.paths).toHaveLength(10);
    expect(group.paths[0]).toBe('/app/page-0');
    expect(group.lastSeen).toEqual(new Date(first.getTime() + 11 * 60_000));
    const ttl = (await collections(db).errorReports.indexes()).find((i) => i.name === 'error_reports_ttl');
    expect(ttl).toMatchObject({ key: { lastSeen: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60 });
  });
});
