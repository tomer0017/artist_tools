'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Check, Loader2 } from 'lucide-react';
import { localizedPath } from '@/i18n/config';
import { authClient } from '@/lib/auth-client';
import { AuthCard, Notice, PasswordField, TextField } from './AuthCard';
import { PRIMARY_BUTTON, authErrorKey, verifiedReturn } from './ui';

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}


export default function SignInCard({
  callbackPath,
  available,
  error,
  registration,
  emailPassword = false,
}: {
  callbackPath: string;
  /** False until this server's Google OAuth client is configured. */
  available: boolean;
  error: string | null;
  /** 'open': anyone can create an account; 'invite': only invited accounts can. */
  registration: 'open' | 'invite';
  /** Whether this server offers email + password sign-in. */
  emailPassword?: boolean;
}) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const included = [t('includedTools'), emailPassword ? t('includedMethods') : t('includedGoogleOnly'), t('includedPrivacy')];
  const [state, setState] = useState<'idle' | 'redirecting' | 'failed'>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailState, setEmailState] = useState<{ status: 'idle' | 'busy' } | { status: 'error'; message: string } | { status: 'unverified'; email: string }>({ status: 'idle' });

  async function signIn() {
    setState('redirecting');
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: callbackPath,
      errorCallbackURL: `/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`,
    });
    // On success the browser is already on its way to Google.
    if (result.error) setState('failed');
  }

  async function signInWithEmail(event: React.FormEvent) {
    event.preventDefault();
    setEmailState({ status: 'busy' });
    const address = email.trim();
    const result = await authClient.signIn.email({ email: address, password, callbackURL: verifiedReturn(callbackPath, locale) });
    // On success the browser is already on its way back into the studio.
    if (!result.error) return;
    setPassword('');
    if (result.error.code === 'EMAIL_NOT_VERIFIED') setEmailState({ status: 'unverified', email: address });
    else setEmailState({ status: 'error', message: t(`errors.${authErrorKey(result.error)}`) });
  }

  const message = state === 'failed' ? t('googleUnreachable') : error;
  const createAccount = `${localizedPath('/sign-up', locale)}?callbackURL=${encodeURIComponent(callbackPath)}`;

  return (
    <AuthCard title={registration === 'open' ? t('titleOpen') : t('titleInvite')} lead={registration === 'open' ? t('leadOpen') : t('leadInvite')}>
      <ul className="mt-4 space-y-1.5" aria-label={t('whatYouGet')}>
        {included.map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm text-foreground">
            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> {item}
          </li>
        ))}
      </ul>

      {!available && <Notice tone="info">{t('notSetUp')}</Notice>}
      {message && <Notice tone="error">{message}</Notice>}

      <button
        type="button"
        onClick={signIn}
        disabled={!available || state === 'redirecting'}
        className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 text-[15px] font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
      >
        {state === 'redirecting' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <GoogleLogo />}
        {state === 'redirecting' ? t('openingGoogle') : t('continueGoogle')}
      </button>

      {emailPassword && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" /> {t('or')} <span className="h-px flex-1 bg-border" />
          </div>
          <form onSubmit={signInWithEmail} aria-label={t('signInWithEmail')} className="space-y-4" noValidate>
            <TextField
              label={t('email')}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <PasswordField label={t('password')} name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="-mt-1 text-end">
              <Link href={localizedPath('/forgot-password', locale)} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                {t('forgot')}
              </Link>
            </div>
            <button type="submit" disabled={emailState.status === 'busy' || !email.trim() || !password} className={PRIMARY_BUTTON}>
              {emailState.status === 'busy' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
              {emailState.status === 'busy' ? t('signingIn') : t('signIn')}
            </button>
          </form>
          {emailState.status === 'error' && <Notice tone="error">{emailState.message}</Notice>}
          {emailState.status === 'unverified' && (
            <Notice tone="info">{t('unverified', { email: emailState.email })}</Notice>
          )}
          <p className="mt-5 text-sm text-muted-foreground">
            {t('newHere')}{' '}
            <Link href={createAccount} className="font-medium text-primary underline-offset-2 hover:underline">
              {t('createAccount')}
            </Link>
          </p>
        </>
      )}

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        {emailPassword ? t('googleDataNoteWithEmail') : t('googleDataNote')} {t('noMarketing')}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        {t.rich('plansLink', {
          link: (chunks) => (
            <Link href={localizedPath('/pricing', locale)} className="font-medium text-primary underline-offset-2 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </AuthCard>
  );
}
