import 'server-only';
import { NextResponse } from 'next/server';
import type { Db } from 'mongodb';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { getEntitlements, type Entitlements } from '@/server/entitlements';
import { THROTTLES, consumeThrottle } from '@/server/security/throttle';
import { getSession } from '@/server/session';

// What every Learn route does first (ADR-0017): a verified session (else
// 401), the account's entitlements fresh from the database, and a per-account
// request limit for everyone but admins. Nothing here is cached: each request
// is authorized when it arrives, so access that ends ends at once.

export const learnJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

export type LearnRequest = { db: Db; entitlements: Entitlements };

export async function learnRequest(): Promise<LearnRequest | Response> {
  const session = await getSession();
  const userId = session ? toObjectId(session.user.id) : null;
  if (!userId) return learnJson({ error: 'unauthorized' }, 401);
  const db = getDb();
  const entitlements = await getEntitlements(db, userId);
  if (!entitlements.accountActive) return learnJson({ error: 'unauthorized' }, 401);
  if (entitlements.access !== 'admin') {
    const { allowed } = await consumeThrottle(db, 'learn', userId.toHexString(), THROTTLES.learnRequests);
    if (!allowed) return learnJson({ error: 'too_many_requests' }, 429);
  }
  return { db, entitlements };
}
