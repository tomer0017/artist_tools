'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { ReauthPanel } from '@/components/account/parts';
import { confirmAdminMfa, disableAdminMfa, regenerateAdminRecoveryCodes, startAdminMfa, type MfaResult } from './actions';
import { QrCode } from './QrCode';

// Set up, manage and turn off two-factor verification for this administrator.

const BUTTON = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`;
const SECONDARY = `${BUTTON} border border-border bg-secondary/60 text-foreground hover:bg-secondary`;
const DANGER = `${BUTTON} border border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20`;
const INPUT = 'mt-1.5 block h-12 w-full max-w-xs rounded-xl border border-border bg-background px-3 font-mono text-lg tracking-[0.3em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Viewer = { email: string; hasPassword: boolean; returnTo: string };
type Mode =
  | { kind: 'idle' }
  | { kind: 'reauth'; then: 'start' | 'disable' }
  | { kind: 'enrolling'; secret: string; uri: string; qr: string[] }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'regenerate' }
  | { kind: 'disable' };

export function MfaSettings({ enrolled, since, recoveryCodesLeft, fresh, viewer }: {
  enrolled: boolean;
  since: string | null;
  recoveryCodesLeft: number;
  fresh: boolean;
  viewer: Viewer;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const fail = (result: Extract<MfaResult, { ok: false }>, then: 'start' | 'disable') => {
    if (result.reason === 'reauth') setMode({ kind: 'reauth', then });
    setMessage({ tone: 'error', text: result.message });
  };

  const begin = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await startAdminMfa();
      if (result.ok === false) return fail(result, 'start');
      setMode({ kind: 'enrolling', secret: result.secret, uri: result.uri, qr: result.qr });
    });

  if (mode.kind === 'codes') return <RecoveryCodes codes={mode.codes} onDone={() => { setMode({ kind: 'idle' }); router.refresh(); }} />;

  if (mode.kind === 'reauth') {
    return (
      <div className="mt-4">
        <ReauthPanel
          email={viewer.email}
          hasPassword={viewer.hasPassword}
          returnTo={viewer.returnTo}
          onConfirmed={() => {
            setMode({ kind: 'idle' });
            setMessage({ tone: 'ok', text: 'Thank you. Now continue.' });
            router.refresh();
          }}
          onCancel={() => setMode({ kind: 'idle' })}
        />
      </div>
    );
  }

  if (mode.kind === 'enrolling') {
    return (
      <div className="mt-4 space-y-4">
        <ol className="space-y-3 text-sm text-foreground">
          <li>
            <strong>1.</strong> In your authenticator app, add an account by scanning this code — or, on this phone, open the link below.
          </li>
        </ol>
        <div className="flex flex-wrap items-start gap-4">
          <QrCode rows={mode.qr} label="QR code for your authenticator app" />
          <div className="min-w-0 space-y-2 text-sm">
            <a href={mode.uri} className={SECONDARY}>
              <Smartphone className="h-4 w-4" aria-hidden="true" /> Open in an authenticator app
            </a>
            <p className="text-muted-foreground">Or type this setup key:</p>
            <p data-testid="mfa-setup-key" className="break-all rounded-lg bg-secondary/50 px-3 py-2 font-mono text-sm text-foreground">
              {mode.secret.match(/.{1,4}/g)!.join(' ')}
            </p>
          </div>
        </div>
        <CodeForm
          label="2. Enter the 6-digit code the app shows"
          submitLabel="Turn on two-factor verification"
          pending={pending}
          numeric
          onSubmit={(code) =>
            startTransition(async () => {
              setMessage(null);
              const result = await confirmAdminMfa({ code });
              if (result.ok === false) return setMessage({ tone: 'error', text: result.message });
              setMode({ kind: 'codes', codes: result.recoveryCodes ?? [] });
            })
          }
          onCancel={() => setMode({ kind: 'idle' })}
        />
        <Status message={message} />
      </div>
    );
  }

  if (!enrolled) {
    return (
      <div className="mt-4">
        <p className="text-sm text-foreground">Not set up.</p>
        {!fresh && <p className="mt-1 text-xs text-muted-foreground">You will be asked to confirm it is you first.</p>}
        <button type="button" className={`mt-3 ${PRIMARY}`} disabled={pending} onClick={begin}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Set up two-factor verification
        </button>
        <Status message={message} />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="flex items-center gap-2 text-sm text-foreground">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> On since {since}.
      </p>
      <p className={`text-sm ${recoveryCodesLeft <= 3 ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
        {recoveryCodesLeft} of 10 recovery codes left{recoveryCodesLeft <= 3 ? ' — make new ones soon.' : '.'}
      </p>
      {mode.kind === 'regenerate' && (
        <CodeForm
          label="Enter a code from your authenticator app to make new recovery codes (the old ones stop working)"
          submitLabel="Make new recovery codes"
          pending={pending}
          numeric
          onSubmit={(code) =>
            startTransition(async () => {
              setMessage(null);
              const result = await regenerateAdminRecoveryCodes({ code });
              if (result.ok === false) return setMessage({ tone: 'error', text: result.message });
              setMode({ kind: 'codes', codes: result.recoveryCodes ?? [] });
            })
          }
          onCancel={() => setMode({ kind: 'idle' })}
        />
      )}
      {mode.kind === 'disable' && (
        <CodeForm
          label="Enter a code from your authenticator app, or a recovery code, to turn two-factor verification off"
          submitLabel="Turn off"
          danger
          pending={pending}
          onSubmit={(code) =>
            startTransition(async () => {
              setMessage(null);
              const result = await disableAdminMfa({ code });
              if (result.ok === false) return fail(result, 'disable');
              setMode({ kind: 'idle' });
              setMessage({ tone: 'ok', text: 'Two-factor verification is off.' });
              router.refresh();
            })
          }
          onCancel={() => setMode({ kind: 'idle' })}
        />
      )}
      {mode.kind === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} onClick={() => { setMessage(null); setMode({ kind: 'regenerate' }); }}>
            <KeyRound className="h-4 w-4" aria-hidden="true" /> New recovery codes
          </button>
          <button type="button" className={DANGER} onClick={() => { setMessage(null); setMode(fresh ? { kind: 'disable' } : { kind: 'reauth', then: 'disable' }); }}>
            Turn off…
          </button>
        </div>
      )}
      <Status message={message} />
    </div>
  );
}

function CodeForm({ label, submitLabel, pending, numeric, danger, onSubmit, onCancel }: {
  label: string;
  submitLabel: string;
  pending: boolean;
  numeric?: boolean;
  danger?: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(code);
      }}
    >
      <label className="block text-sm font-medium text-foreground">
        {label}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={numeric ? 'numeric' : 'text'}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={numeric ? 6 : 20}
          required
          className={INPUT}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={danger ? DANGER : PRIMARY} disabled={pending || code.trim().length < 6}>
          {submitLabel}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const download = () => {
    const text = `Studio Companion — admin recovery codes\nEach code works once. Keep them somewhere safe, away from your phone.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'studio-companion-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div className="mt-4 space-y-3">
      <p role="status" className="text-sm font-semibold text-foreground">
        Two-factor verification is on. Save these recovery codes now — they are shown only once.
      </p>
      <p className="text-sm text-muted-foreground">
        If you lose your phone, each code lets you in once. Keep them somewhere safe, away from the phone (a password manager, or printed).
      </p>
      <ul aria-label="Recovery codes" className="grid max-w-sm grid-cols-2 gap-2 rounded-xl bg-secondary/40 p-3 font-mono text-sm text-foreground">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SECONDARY} onClick={download}>
          <Download className="h-4 w-4" aria-hidden="true" /> Download as a text file
        </button>
        <button type="button" className={PRIMARY} onClick={onDone}>
          I have saved them
        </button>
      </div>
    </div>
  );
}

function Status({ message }: { message: { tone: 'ok' | 'error'; text: string } | null }) {
  if (!message) return null;
  return (
    <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-primary'}`}>
      {message.text}
    </p>
  );
}
