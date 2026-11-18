// What this release says about a catalog version it read (ADR-0014): nothing
// when it knows and applies all of it; what it keeps without applying; or
// why it applies less (features withheld) or nothing (unreadable, `plans`
// left as it was) and does not edit it here.

export type CatalogReadStatus = 'ok' | 'partial' | 'unreadable';

function Notes({ notes }: { notes: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-0.5 pl-5">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export function CatalogReadNotice({ label, status, notes }: { label: string; status: CatalogReadStatus; notes: string[] }) {
  if (status === 'ok' && notes.length === 0) return null;
  if (status === 'ok') {
    return (
      <div role="status" className="mt-4 rounded-xl border border-border bg-card p-4 text-sm text-foreground">
        <p>
          <strong>{label}</strong> also holds settings this version of the app does not use. They are kept exactly as they are when you edit and publish here, and
          nothing they describe is applied by this version.
        </p>
        <Notes notes={notes} />
      </div>
    );
  }
  return (
    <div role="alert" className="mt-4 rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-foreground">
      {status === 'partial' ? (
        <p>
          This version of the app cannot apply some settings of <strong>{label}</strong>, so it withholds those features (it never grants more than was published).
          Editing it is turned off here: use the release that wrote it.
        </p>
      ) : (
        <p>
          This version of the app cannot read <strong>{label}</strong>, so it changed nothing: every account keeps the plans last applied, shown below. Editing is
          turned off here: use the release that wrote it.
        </p>
      )}
      <Notes notes={notes} />
    </div>
  );
}
