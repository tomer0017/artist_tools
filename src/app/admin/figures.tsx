import { formatMoney } from '@/lib/money';

// Headline figures shared by the admin pages (server-rendered).

/** "$9.90 · ₪39.00": amounts per currency, never converted; "—" when there are none. */
export const moneyList = (amounts: Record<string, number>) =>
  Object.entries(amounts)
    .map(([currency, amount]) => formatMoney(amount, currency as 'USD'))
    .join(' · ') || '—';

export function Tile({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
