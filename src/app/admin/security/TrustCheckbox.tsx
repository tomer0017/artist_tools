'use client';

import { TRUST_IDLE_DAYS, TRUST_MAX_DAYS } from './trust';

/** "Trust this device": offered with every code (on by default; off on a shared computer). */
export function TrustCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-foreground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
      <span>
        Trust this device for {TRUST_IDLE_DAYS} days
        <span className="mt-0.5 block text-xs text-muted-foreground">
          No code on this device while you use it at least every {TRUST_IDLE_DAYS} days, and a code again at least every {TRUST_MAX_DAYS} days. Leave
          it off on a shared computer.
        </span>
      </span>
    </label>
  );
}
