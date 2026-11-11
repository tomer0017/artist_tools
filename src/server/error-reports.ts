import 'server-only';
import { createHash } from 'node:crypto';
import type { Db } from 'mongodb';
import { collections, type ErrorReportDoc } from '@/server/db/collections';

// ─── Error monitoring, first-party (docs/ops/monitoring.md) ───────────────────
// Errors from browsers (POST /api/client-errors) and from the server
// (src/instrumentation.ts) are grouped by fingerprint in our own database,
// for the admin's Errors page. What is kept is about the code, not people:
// no account id, no IP address, no query strings, no request bodies; email
// addresses and anything that looks like a token are removed. A group not
// seen for 30 days removes itself (TTL).

export const KEEP_DAYS = 30;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_LIST = 10;

/** Remove what could identify a person or carry a secret: emails, query strings and fragments, long tokens. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(https?:\/\/[^\s?#)'"]+)[?#][^\s)'"]*/g, '$1')
    .replace(/([?&][\w-]+=)[^\s&)'"]+/g, '$1[…]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token]');
}

/** A path without query or fragment, and with ids folded, so similar pages group together. */
export function cleanPath(path: string): string {
  return (path.split(/[?#]/)[0] || '/').replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/[id]').slice(0, 200);
}

/** The same error from the same place groups together: the message and the first stack line. */
export function fingerprint(source: string, message: string, stack: string): string {
  const top = stack.split('\n').find((line) => /\bat\b|@/.test(line))?.replace(/:\d+:\d+/g, '') ?? '';
  return createHash('sha256').update(`${source}\n${message.replace(/\d+/g, 'N')}\n${top.trim()}`).digest('base64url').slice(0, 32);
}

export interface ErrorReport {
  source: 'client' | 'server';
  message: string;
  stack?: string | null;
  path: string;
  release: string | null;
  /** Browser and system names only ("Safari on iPhone"), never the full user agent. */
  browser?: string | null;
}

export async function recordError(db: Db, report: ErrorReport, now = new Date()): Promise<void> {
  const message = scrub(report.message).slice(0, MAX_MESSAGE) || '(no message)';
  const stack = scrub(report.stack ?? '').slice(0, MAX_STACK);
  const id = fingerprint(report.source, message, stack);
  const add = (field: 'paths' | 'releases' | 'browsers', value: string | null | undefined) =>
    value ? { [field]: { $cond: [{ $or: [{ $in: [value, `$${field}`] }, { $gte: [{ $size: `$${field}` }, MAX_LIST] }] }, `$${field}`, { $concatArrays: [`$${field}`, [value]] }] } } : {};
  await collections(db).errorReports.updateOne(
    { _id: id },
    [
      {
        $set: {
          source: report.source,
          message,
          stack: { $ifNull: ['$stack', stack] },
          count: { $add: [{ $ifNull: ['$count', 0] }, 1] },
          firstSeen: { $ifNull: ['$firstSeen', now] },
          lastSeen: now,
          paths: { $ifNull: ['$paths', []] },
          releases: { $ifNull: ['$releases', []] },
          browsers: { $ifNull: ['$browsers', []] },
        },
      },
      { $set: { ...add('paths', cleanPath(report.path)), ...add('releases', report.release), ...add('browsers', report.browser) } },
    ],
    { upsert: true },
  );
}

export async function listErrors(db: Db, limit = 100): Promise<ErrorReportDoc[]> {
  return collections(db).errorReports.find({}, { sort: { lastSeen: -1 }, limit }).toArray();
}
