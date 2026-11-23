'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Laptop } from 'lucide-react';
import { forgetAdminDevice, forgetAllAdminDevices } from './actions';

const BUTTON = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 px-3.5 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60';

export interface TrustedDeviceRow {
  id: string;
  label: string;
  trusted: string;
  lastUsed: string;
  asksAgain: string;
  current: boolean;
}

/** The devices that pass without a code, each with Forget; Forget all at the end. */
export function TrustedDevices({ devices }: { devices: TrustedDeviceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const run = (action: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      setMessage(null);
      const result = await action();
      setMessage({ tone: result.ok ? 'ok' : 'error', text: result.message });
      router.refresh();
    });

  return (
    <div className="mt-3">
      {devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No trusted devices: every new session asks for a code.</p>
      ) : (
        <ul aria-label="Trusted devices" className="divide-y divide-border">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {d.label}
                    {d.current && <span className="ms-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">This device</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Trusted {d.trusted} · last used {d.lastUsed} · asks for a code again by {d.asksAgain}
                  </p>
                </div>
              </div>
              <button type="button" className={BUTTON} disabled={pending} aria-label={`Forget ${d.label}${d.current ? ' (this device)' : ''}`} onClick={() => run(() => forgetAdminDevice({ id: d.id }))}>
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
      {devices.length > 1 && (
        <button type="button" className={`mt-2 ${BUTTON}`} disabled={pending} onClick={() => run(() => forgetAllAdminDevices())}>
          Forget all devices
        </button>
      )}
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-primary'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
