'use client';

import { useCallback, useEffect, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Download, KeyRound, Laptop, Link2, LogOut, Pencil, Trash2 } from 'lucide-react';
import { PasswordField } from '@/components/auth/AuthCard';
import { authClient } from '@/lib/auth-client';
import { clearDeviceWork } from '@/lib/device-data';
import { CURRENCIES, CURRENCY_NAMES, LOCALES, LOCALE_NAMES, type Currency, type Locale } from '@/lib/locale';
import {
  addPassword,
  deleteMyAccount,
  loadDeviceSessions,
  saveMarketingConsent,
  saveProfile,
  signOutDevice,
  signOutOtherDevices,
} from '@/app/app/profile/actions';
import type { DeviceSession } from '@/server/account-management';
import type { StudioAccount } from '@/components/shell/account';
import { Busy, CARD, DANGER_BUTTON, PRIMARY_SMALL_BUTTON, ReauthPanel, SECONDARY_BUTTON, StatusLine, statusOf, type Status } from './parts';

// The editable sections of the account page. Each change goes to a server
// action that acts only on the signed-in account; the page then re-reads the
// account (`onChanged`) so what it shows is what the server stored.

const PASSWORD_HINT = 'At least 12 characters. A short sentence or a few unrelated words work well.';
const shortDate = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
const dateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

const SELECT =
  'mt-1.5 block h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function NameEditor({ account, onChanged }: { account: StudioAccount; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  if (!editing) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setName(account.name); setStatus(null); setEditing(true); }} className={SECONDARY_BUTTON}>
          <Pencil className="h-4 w-4" aria-hidden="true" /> Edit name
        </button>
        {account.image && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await saveProfile({ removeImage: true });
              setBusy(false);
              setStatus(result.ok ? { tone: 'ok', text: 'Photo removed: your initials are shown instead.' } : statusOf(result));
              if (result.ok) await onChanged();
            }}
            className={SECONDARY_BUTTON}
          >
            Remove photo
          </button>
        )}
        <StatusLine status={status} />
      </div>
    );
  }

  return (
    <form
      className="mt-3 space-y-3"
      aria-label="Edit your name"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const result = await saveProfile({ name });
        setBusy(false);
        setStatus(statusOf(result));
        if (result.ok) {
          setEditing(false);
          await onChanged();
        }
      }}
    >
      <label className="block text-sm font-medium text-foreground">
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" required className={SELECT} />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={busy || !name.trim()} className={PRIMARY_SMALL_BUTTON}>
          <Busy busy={busy} label="Save" busyLabel="Saving…" />
        </button>
        <button type="button" onClick={() => setEditing(false)} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
      <StatusLine status={status} />
    </form>
  );
}

export function PreferencesCard({ account, onChanged }: { account: StudioAccount; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function save(change: { locale?: Locale; currency?: Currency }) {
    setBusy(true);
    const result = await saveProfile(change);
    setBusy(false);
    setStatus(statusOf(result) ?? { tone: 'ok', text: 'Saved.' });
    if (result.ok) await onChanged();
  }

  return (
    <section aria-label="Preferences" className={CARD}>
      <p className="font-semibold text-foreground">Preferences</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pref-language" className="text-sm font-medium text-foreground">
            Language
          </label>
          <select id="pref-language" aria-describedby="pref-language-hint" value={account.locale} disabled={busy} onChange={(e) => save({ locale: e.target.value as Locale })} className={SELECT}>
            {LOCALES.map((locale) => (
              <option key={locale} value={locale} lang={locale}>
                {LOCALE_NAMES[locale]}
              </option>
            ))}
          </select>
          <p id="pref-language-hint" className="mt-1 text-xs text-muted-foreground">
            The studio is in English for now; Hebrew is coming.
          </p>
        </div>
        <div>
          <label htmlFor="pref-currency" className="text-sm font-medium text-foreground">
            Currency
          </label>
          <select id="pref-currency" aria-describedby="pref-currency-hint" value={account.currency} disabled={busy} onChange={(e) => save({ currency: e.target.value as Currency })} className={SELECT}>
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {CURRENCY_NAMES[currency]}
              </option>
            ))}
          </select>
          <p id="pref-currency-hint" className="mt-1 text-xs text-muted-foreground">
            For prices, once paid plans exist.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <p id="marketing-label" className="text-sm font-medium text-foreground">
            News by email
          </p>
          <p id="marketing-detail" className="mt-0.5 text-xs text-muted-foreground">
            Occasional emails about new tools and features. Off unless you turn it on; you can turn it off any time.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={account.marketingConsent}
          aria-labelledby="marketing-label"
          aria-describedby="marketing-detail"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await saveMarketingConsent({ granted: !account.marketingConsent });
            setBusy(false);
            setStatus(statusOf(result));
            if (result.ok) await onChanged();
          }}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${account.marketingConsent ? 'bg-primary' : 'bg-secondary ring-1 ring-border'}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${account.marketingConsent ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <StatusLine status={status} />
    </section>
  );
}

export function SignInMethodsCard({ account, onChanged }: { account: StudioAccount; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'idle' | 'add-password' | 'change-password' | 'reauth-add'>('idle');
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [error, setError] = useState<string | null>(null);
  const { google, password: hasPassword } = account.methods;

  const reset = () => {
    setMode('idle');
    setPassword('');
    setCurrent('');
    setError(null);
  };

  async function submitAdd(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    const result = await addPassword({ password });
    setBusy(false);
    if (result.ok === false) return result.reason === 'reauth' ? setMode('reauth-add') : setError(result.message);
    reset();
    setStatus(statusOf(result));
    await onChanged();
  }

  async function submitChange(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.changePassword({ currentPassword: current, newPassword: password, revokeOtherSessions: true });
    setBusy(false);
    if (result.error) {
      setError(
        result.error.code === 'INVALID_PASSWORD'
          ? 'Your current password is not right.'
          : result.error.code?.startsWith('PASSWORD_') && result.error.message
            ? result.error.message
            : 'That did not work. Please try again.',
      );
      return;
    }
    reset();
    setStatus({ tone: 'ok', text: 'Password changed. Your other devices were signed out.' });
  }

  async function connectGoogle() {
    setBusy(true);
    const result = await authClient.linkSocial({ provider: 'google', callbackURL: '/app/profile?connected=google', errorCallbackURL: '/app/profile?connect_error=google' });
    if (result.error) {
      setBusy(false);
      setStatus({ tone: 'error', text: 'Could not reach Google. Check your connection and try again.' });
    }
  }

  async function disconnectGoogle() {
    setBusy(true);
    const result = await authClient.unlinkAccount({ providerId: 'google' });
    setBusy(false);
    if (result.error) {
      setStatus({
        tone: 'error',
        text: result.error.code === 'SESSION_NOT_FRESH' ? 'For your security, sign out and sign in again with your password, then disconnect Google.' : 'That did not work. Please try again.',
      });
      return;
    }
    setStatus({ tone: 'ok', text: 'Google is disconnected. Sign in with your email and password from now on.' });
    await onChanged();
  }

  return (
    <section aria-label="Sign-in methods" className={CARD}>
      <p className="font-semibold text-foreground">How you sign in</p>
      <ul className="mt-2 divide-y divide-border">
        <li className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Google
            </p>
            <p className="text-xs text-muted-foreground">{google ? 'Connected' : 'Not connected'}</p>
          </div>
          {google && hasPassword && (
            <button type="button" onClick={disconnectGoogle} disabled={busy} className={SECONDARY_BUTTON}>
              Disconnect Google
            </button>
          )}
          {!google && account.emailPasswordEnabled && (
            <button type="button" onClick={connectGoogle} disabled={busy} className={SECONDARY_BUTTON}>
              Connect Google
            </button>
          )}
        </li>
        <li className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Email and password
              </p>
              <p className="text-xs text-muted-foreground">{hasPassword ? `Password set · ${account.email}` : 'No password'}</p>
            </div>
            {mode === 'idle' && hasPassword && (
              <button type="button" onClick={() => { setStatus(null); setMode('change-password'); }} className={SECONDARY_BUTTON}>
                Change password
              </button>
            )}
            {mode === 'idle' && !hasPassword && account.emailPasswordEnabled && (
              <button type="button" onClick={() => { setStatus(null); setMode('add-password'); }} className={SECONDARY_BUTTON}>
                Add a password
              </button>
            )}
          </div>

          {mode === 'add-password' && (
            <form onSubmit={submitAdd} className="mt-3 space-y-3" aria-label="Add a password">
              <p className="text-sm text-muted-foreground">You will then be able to sign in with {account.email} and this password, as well as with Google.</p>
              <PasswordField label="New password" autoComplete="new-password" hint={PASSWORD_HINT} error={error} value={password} onChange={(e) => setPassword(e.target.value)} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="submit" disabled={busy || password.length < 12} className={PRIMARY_SMALL_BUTTON}>
                  <Busy busy={busy} label="Add password" busyLabel="Saving…" />
                </button>
                <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {mode === 'reauth-add' && (
            <ReauthPanel
              email={account.email}
              hasPassword={false}
              onConfirmed={() => void submitAdd()}
              onCancel={reset}
            />
          )}
          {mode === 'change-password' && (
            <form onSubmit={submitChange} className="mt-3 space-y-3" aria-label="Change password">
              <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              <PasswordField label="New password" autoComplete="new-password" hint={PASSWORD_HINT} error={error} value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">Changing it signs you out on your other devices.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="submit" disabled={busy || !current || password.length < 12} className={PRIMARY_SMALL_BUTTON}>
                  <Busy busy={busy} label="Change password" busyLabel="Saving…" />
                </button>
                <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </li>
      </ul>
      <StatusLine status={status} />
    </section>
  );
}

export function DevicesCard() {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await loadDeviceSessions();
    if ('sessions' in result) setSessions(result.sessions);
    else setStatus(statusOf(result));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const others = sessions?.filter((s) => !s.current) ?? [];
  return (
    <section aria-label="Signed-in devices" className={CARD}>
      <p className="font-semibold text-foreground">Signed-in devices</p>
      <p className="mt-1 text-sm text-muted-foreground">Where your account is signed in right now. Sign out anything you do not recognise.</p>
      {sessions === null && !status && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {sessions && (
        <ul className="mt-2 divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {s.device}
                    {s.current && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">This device</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Active {dateTime(s.lastActiveAt)}
                    {s.network ? ` · ${s.network}` : ''} · signed in {shortDate(s.signedInAt)}
                  </p>
                </div>
              </div>
              {!s.current && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Sign out ${s.device}, active ${dateTime(s.lastActiveAt)}`}
                  onClick={async () => {
                    setBusy(true);
                    const result = await signOutDevice({ sessionId: s.id });
                    setBusy(false);
                    setStatus(statusOf(result));
                    await load();
                  }}
                  className={SECONDARY_BUTTON}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await signOutOtherDevices();
            setBusy(false);
            setStatus(statusOf(result));
            await load();
          }}
          className={`mt-2 ${SECONDARY_BUTTON}`}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out of all other devices
        </button>
      )}
      <StatusLine status={status} />
      <p className="mt-3 text-xs text-muted-foreground">A device you sign out is signed out the next time it contacts Studio Companion.</p>
    </section>
  );
}

export function DataCard({ account }: { account: StudioAccount }) {
  const [exportStatus, setExportStatus] = useState<Status>(null);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [clearDevice, setClearDevice] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<Status>(null);
  const [reauth, setReauth] = useState(false);

  async function download() {
    setExporting(true);
    setExportStatus(null);
    try {
      const response = await fetch('/api/me/export', { method: 'POST', credentials: 'same-origin' });
      if (response.status === 429) throw new Error('Too many downloads in the last hour. Please try again later.');
      if (!response.ok) throw new Error('The download did not work. Please try again.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'studio-companion-account.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportStatus({ tone: 'ok', text: 'Your data was downloaded as a JSON file.' });
    } catch (error) {
      setExportStatus({ tone: 'error', text: error instanceof Error ? error.message : 'The download did not work.' });
    } finally {
      setExporting(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setDeleteStatus(null);
    const result = await deleteMyAccount({ confirmation });
    if (result.ok === true) {
      if (clearDevice) clearDeviceWork();
      window.location.assign(new URL('/?account=deleted', window.location.origin));
      return;
    }
    setDeleting(false);
    if (result.reason === 'reauth') {
      setOpen(false);
      setReauth(true);
      return;
    }
    if (result.reason === 'signed_out') {
      window.location.assign(new URL('/sign-in', window.location.origin));
      return;
    }
    setDeleteStatus(statusOf(result));
  }

  return (
    <section aria-label="Your data" className={CARD}>
      <p className="font-semibold text-foreground">Your data</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Download everything Studio Companion keeps about you: your profile, preferences, sign-in methods, devices and activity. Your images are not in it,
        because they never leave your device.
      </p>
      <button type="button" onClick={download} disabled={exporting} className={`mt-3 ${SECONDARY_BUTTON}`}>
        <Download className="h-4 w-4" aria-hidden="true" /> <Busy busy={exporting} label="Download my data" busyLabel="Preparing…" />
      </button>
      <StatusLine status={exportStatus} />

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-sm font-semibold text-foreground">Delete account</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Deletes your account and the personal data kept with it, permanently. It cannot be undone.
        </p>
        <AlertDialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setConfirmation(''); setDeleteStatus(null); } }}>
          <AlertDialog.Trigger asChild>
            <button type="button" className={`mt-3 ${DANGER_BUTTON}`} onClick={() => setReauth(false)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete account…
            </button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
            <AlertDialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl outline-none md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
              <AlertDialog.Title className="text-lg font-semibold text-foreground">Delete your account?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                Your account ({account.email}), your settings and your activity history are deleted for good, and you are signed out everywhere.
              </AlertDialog.Description>
              <label className="mt-4 flex items-start gap-3 text-sm text-foreground">
                <input type="checkbox" checked={clearDevice} onChange={(e) => setClearDevice(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]" />
                Also remove the work stored in this browser (your current project and comparison)
              </label>
              <label className="mt-4 block text-sm font-medium text-foreground">
                Type DELETE to confirm
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="mt-1.5 block h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <StatusLine status={deleteStatus} />
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <AlertDialog.Cancel className={SECONDARY_BUTTON}>Keep my account</AlertDialog.Cancel>
                <button type="button" onClick={remove} disabled={deleting || confirmation.trim().toUpperCase() !== 'DELETE'} className={DANGER_BUTTON}>
                  <Busy busy={deleting} label="Delete permanently" busyLabel="Deleting…" />
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
        {reauth && (
          <ReauthPanel
            email={account.email}
            hasPassword={account.methods.password}
            onConfirmed={() => {
              setReauth(false);
              setOpen(true);
            }}
            onCancel={() => setReauth(false)}
          />
        )}
      </div>
    </section>
  );
}
