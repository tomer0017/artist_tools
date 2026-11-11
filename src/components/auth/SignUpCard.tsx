'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Loader2, MailCheck } from 'lucide-react';
import { localizedPath } from '@/i18n/config';
import { authClient } from '@/lib/auth-client';
import { AuthCard, Notice, PasswordField, TextField } from './AuthCard';
import { PRIMARY_BUTTON, authErrorKey, isPasswordError, verifiedReturn } from './ui';

// Create an account with an email address and a password. The server answers
// every accepted request the same way (new, already registered or not
// invited), so this page always ends on "check your email": only the owner of
// the address learns which it was, from the email they receive.

export default function SignUpCard({ callbackPath, registration }: { callbackPath: string; registration: 'open' | 'invite' }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<
    { status: 'idle' | 'busy' } | { status: 'sent'; email: string } | { status: 'error'; message: string; field: 'password' | null }
  >({ status: 'idle' });
  const signIn = `${localizedPath('/sign-in', locale)}?callbackURL=${encodeURIComponent(callbackPath)}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ status: 'busy' });
    const address = email.trim();
    const result = await authClient.signUp.email({ name: name.trim(), email: address, password, callbackURL: verifiedReturn(callbackPath, locale) });
    if (!result.error) {
      setPassword('');
      setState({ status: 'sent', email: address });
      return;
    }
    const key = authErrorKey(result.error);
    setState({ status: 'error', message: t(`errors.${key}`), field: isPasswordError(key) ? 'password' : null });
  }

  if (state.status === 'sent') {
    return (
      <AuthCard title={t('signUp.checkTitle')}>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p role="status" className="text-sm leading-relaxed text-foreground">
            {t.rich('signUp.checkSent', { email: state.email, strong: (chunks) => <strong className="break-all">{chunks}</strong> })}
          </p>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {registration === 'invite' ? `${t('signUp.checkInvite')} ` : ''}
          {t('signUp.checkMore')}
        </p>
        <Link href={signIn} className={`mt-6 ${PRIMARY_BUTTON}`}>
          {t('signUp.backToSignIn')}
        </Link>
      </AuthCard>
    );
  }

  const passwordError = state.status === 'error' && state.field === 'password' ? state.message : null;
  return (
    <AuthCard title={t('signUp.title')} lead={registration === 'invite' ? t('signUp.leadInvite') : t('signUp.leadOpen')}>
      <form onSubmit={submit} aria-label={t('signUp.formLabel')} className="mt-6 space-y-4" noValidate>
        <TextField label={t('signUp.name')} name="name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label={t('email')}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label={t('password')}
          name="new-password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          hint={t('passwordHint')}
          error={passwordError}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={state.status === 'busy' || !name.trim() || !email.trim() || password.length < 12} className={PRIMARY_BUTTON}>
          {state.status === 'busy' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'busy' ? t('signUp.submitting') : t('signUp.submit')}
        </button>
      </form>
      {state.status === 'error' && !passwordError && <Notice tone="error">{state.message}</Notice>}
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{t('signUp.noMarketing')}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        {t('signUp.haveAccount')}{' '}
        <Link href={signIn} className="font-medium text-primary underline-offset-2 hover:underline">
          {t('signIn')}
        </Link>
      </p>
    </AuthCard>
  );
}
