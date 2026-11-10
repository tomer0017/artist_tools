'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PasswordField } from '@/components/auth/AuthCard';
import { authClient } from '@/lib/auth-client';
import type { ActionResult } from '@/app/app/profile/actions';

// Building blocks of the account page sections.

export const CARD = 'mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5';
export const SECONDARY_BUTTON =
  'flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/60 px-4 text-sm font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-auto sm:px-6';
export const PRIMARY_SMALL_BUTTON =
  'flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-auto sm:px-6';
export const DANGER_BUTTON =
  'flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 px-4 text-sm font-semibold text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-auto sm:px-6';

export type Status = { tone: 'ok' | 'error'; text: string } | null;

export function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p role={status.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${status.tone === 'ok' ? 'text-primary' : 'text-destructive'}`}>
      {status.text}
    </p>
  );
}

export const statusOf = (result: ActionResult): Status =>
  result.ok ? (result.message ? { tone: 'ok', text: result.message } : null) : { tone: 'error', text: result.message };

/** Spinner + label while busy. */
export function Busy({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <>
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {busy ? busyLabel : label}
    </>
  );
}

/**
 * "Confirm it is you" for sensitive changes: a fresh sign-in, with the
 * password where the account has one, otherwise with Google (which comes back
 * to the account page). Calls `onConfirmed` once the new session exists.
 */
export function ReauthPanel({ email, hasPassword, onConfirmed, onCancel }: { email: string; hasPassword: boolean; onConfirmed: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    setPassword('');
    if (result.error) {
      setError(result.error.code === 'INVALID_EMAIL_OR_PASSWORD' ? 'That password is not right.' : 'That did not work. Please try again.');
      return;
    }
    onConfirmed();
  }

  async function withGoogle() {
    setBusy(true);
    const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/app/profile?confirmed=1', errorCallbackURL: '/app/profile' });
    if (result.error) {
      setBusy(false);
      setError('Could not reach Google. Check your connection and try again.');
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-semibold text-foreground">Confirm it is you</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasPassword ? 'Enter your password to continue.' : 'Sign in with Google again to continue. You will come back to this page; then repeat the step.'}
      </p>
      {hasPassword ? (
        <form onSubmit={withPassword} className="mt-3 space-y-3" aria-label="Confirm with your password">
          <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={busy || !password} className={PRIMARY_SMALL_BUTTON}>
              <Busy busy={busy} label="Confirm" busyLabel="Checking…" />
            </button>
            <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={withGoogle} disabled={busy} className={PRIMARY_SMALL_BUTTON}>
            <Busy busy={busy} label="Continue with Google" busyLabel="Opening Google…" />
          </button>
          <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
