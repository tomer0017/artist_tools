'use client';

import { useState, useTransition } from 'react';
import { verifyAdminMfa } from '../security/actions';

const INPUT =
  'mt-1.5 block h-12 w-full rounded-xl border border-border bg-background px-3 font-mono text-lg tracking-[0.25em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function VerifyForm({ returnTo }: { returnTo: string }) {
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await verifyAdminMfa({ code });
          if (result.ok === false) {
            setError(result.message);
            return;
          }
          if (recovery) setLeft(result.recoveryCodesLeft ?? 0);
          window.location.assign(returnTo);
        });
      }}
    >
      <label className="block text-sm font-medium text-foreground">
        {recovery ? 'Recovery code' : 'Code from your authenticator app'}
        <input
          key={recovery ? 'recovery' : 'totp'}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={recovery ? 20 : 6}
          required
          autoFocus
          className={INPUT}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {left !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          Recovery code used. {left} left.
        </p>
      )}
      <button
        type="submit"
        disabled={pending || code.trim().length < 6}
        className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {pending ? 'Checking…' : 'Continue'}
      </button>
      <button
        type="button"
        onClick={() => {
          setRecovery(!recovery);
          setCode('');
          setError(null);
        }}
        className="block w-full text-center text-sm font-medium text-primary underline underline-offset-2"
      >
        {recovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
      </button>
    </form>
  );
}
