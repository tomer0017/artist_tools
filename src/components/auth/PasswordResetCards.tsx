'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Loader2, MailCheck } from 'lucide-react';
import { localizedPath } from '@/i18n/config';
import { authClient } from '@/lib/auth-client';
import { AuthCard, Notice, PasswordField, TextField } from './AuthCard';
import { PRIMARY_BUTTON, authErrorKey, isPasswordError } from './ui';

// Forgotten password: ask for a link (the answer is the same whether or not
// the address has an account), then choose a new password from the link.
// The link works once, for 30 minutes, and using it signs out every device.

export function ForgotPasswordCard() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'busy' } | { status: 'sent'; email: string } | { status: 'error'; message: string }>({ status: 'idle' });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ status: 'busy' });
    const address = email.trim();
    const result = await authClient.requestPasswordReset({ email: address, redirectTo: '/reset-password' });
    setState(result.error ? { status: 'error', message: t(`errors.${authErrorKey(result.error)}`) } : { status: 'sent', email: address });
  }

  if (state.status === 'sent') {
    return (
      <AuthCard title={t('signUp.checkTitle')}>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p role="status" className="text-sm leading-relaxed text-foreground">
            {t.rich('forgotCard.sent', { email: state.email, strong: (chunks) => <strong className="break-all">{chunks}</strong> })}
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{t('forgotCard.sentMore')}</p>
        <Link href={localizedPath('/sign-in', locale)} className={`mt-6 ${PRIMARY_BUTTON}`}>
          {t('signUp.backToSignIn')}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('forgotCard.title')} lead={t('forgotCard.lead')}>
      <form onSubmit={submit} aria-label={t('forgotCard.title')} className="mt-6 space-y-4" noValidate>
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
        <button type="submit" disabled={state.status === 'busy' || !email.trim()} className={PRIMARY_BUTTON}>
          {state.status === 'busy' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'busy' ? t('forgotCard.sending') : t('forgotCard.submit')}
        </button>
      </form>
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      <p className="mt-5 text-sm text-muted-foreground">
        {t('forgotCard.remembered')}{' '}
        <Link href={localizedPath('/sign-in', locale)} className="font-medium text-primary underline-offset-2 hover:underline">
          {t('signIn')}
        </Link>
      </p>
    </AuthCard>
  );
}

export function ResetPasswordCard({ token }: { token: string | null }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [password, setPassword] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'done' } | { status: 'error'; message: string; field: 'password' | null; expired: boolean }>({
    status: 'idle',
  });
  const forgot = localizedPath('/forgot-password', locale);

  if (!token) {
    return (
      <AuthCard title={t('resetCard.incompleteTitle')}>
        <Notice tone="error">{t('resetCard.incomplete')}</Notice>
        <Link href={forgot} className={`mt-6 ${PRIMARY_BUTTON}`}>
          {t('resetCard.askNew')}
        </Link>
      </AuthCard>
    );
  }

  if (state.status === 'done') {
    return (
      <AuthCard title={t('resetCard.doneTitle')}>
        <Notice tone="success">{t('resetCard.done')}</Notice>
        <Link href={localizedPath('/sign-in', locale)} className={`mt-6 ${PRIMARY_BUTTON}`}>
          {t('signIn')}
        </Link>
      </AuthCard>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ status: 'busy' });
    const result = await authClient.resetPassword({ newPassword: password, token: token! });
    if (!result.error) {
      setPassword('');
      setState({ status: 'done' });
      return;
    }
    const key = authErrorKey(result.error);
    setState({ status: 'error', message: t(`errors.${key}`), field: isPasswordError(key) ? 'password' : null, expired: key === 'INVALID_TOKEN' });
  }

  const passwordError = state.status === 'error' && state.field === 'password' ? state.message : null;
  return (
    <AuthCard title={t('resetCard.title')} lead={t('resetCard.lead')}>
      <form onSubmit={submit} aria-label={t('resetCard.title')} className="mt-6 space-y-4" noValidate>
        <PasswordField
          label={t('resetCard.newPassword')}
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
        <button type="submit" disabled={state.status === 'busy' || password.length < 12} className={PRIMARY_BUTTON}>
          {state.status === 'busy' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'busy' ? t('resetCard.saving') : t('resetCard.save')}
        </button>
      </form>
      {state.status === 'error' && !passwordError && <Notice tone="error">{state.message}</Notice>}
      {state.status === 'error' && state.expired && (
        <Link href={forgot} className="mt-4 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
          {t('resetCard.askNew')}
        </Link>
      )}
    </AuthCard>
  );
}
