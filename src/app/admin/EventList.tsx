import Link from 'next/link';
import type { AdminAuditEvent } from '@/server/admin';
import { actorLabel, dateTime, describeEvent } from './format';

/** Audit events, newest first: what happened, to whom, by whom and when. */
export function EventList({ events, viewerId, showSubject }: { events: AdminAuditEvent[]; viewerId: string; showSubject: boolean }) {
  if (events.length === 0) return <p className="py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>;
  return (
    <ol className="divide-y divide-border">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
          <time dateTime={event.at.toISOString()} className="shrink-0 text-xs tabular-nums text-muted-foreground sm:w-44">
            {dateTime(event.at)}
          </time>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{describeEvent(event)}</p>
            <p className="break-words text-xs text-muted-foreground">
              {showSubject && event.subject && (
                <>
                  <Link href={`/admin/users/${event.subject.id}`} className="text-primary underline underline-offset-2">
                    {event.subject.email ?? 'deleted account'}
                  </Link>
                  {' · '}
                </>
              )}
              by {actorLabel(event, viewerId)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
