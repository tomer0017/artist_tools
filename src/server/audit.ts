import 'server-only';
import type { Db, ObjectId } from 'mongodb';
import { collections, toObjectId, type AuditEventType, type AuditMetadata } from '@/server/db/collections';

/** Append an audit event. Metadata must hold ids, enums and counts only. */
export async function recordAudit(
  db: Db,
  event: { type: AuditEventType; userId?: string | ObjectId | null; actor: string; metadata?: AuditMetadata },
): Promise<void> {
  await collections(db).auditEvents.insertOne({
    type: event.type,
    userId: toObjectId(event.userId ?? null),
    actor: event.actor,
    at: new Date(),
    metadata: event.metadata ?? {},
  });
}
