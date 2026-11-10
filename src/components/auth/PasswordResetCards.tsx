'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AuthCard, Notice, PasswordField, TextField } from './AuthCard';
import { PASSWORD_HINT, PRIMARY_BUTTON, authErrorMessage } from './ui';

// Forgotten password: ask for a link (the answer is the same whether or not
// the address has an account), then choose a new password from the link.
// The link works once, for 30 minutes, and using it signs out every device.

export function ForgotPasswordCard() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'busy' } | { status: 'sent'; email: string } | { status: 'error'; message: string }>({ status: 'idle' });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ status: 'busy' });
    const address = email.trim();
    const result = await authClient.requestPasswordReset({ email: address, redirectTo: '/reset-password' });
    setState(result.error ? { status: 'error', message: authErrorMessage(result.error) } : { status: 'sent', email: address });
  }

  if (state.status === 'sent') {
    return (
      <AuthCard title="Check your email">
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p role="status" className="text-sm leading-relaxed text-foreground">
            If an account uses <strong className="break-all">{state.email}</strong>, we have sent it a link to choose a new password. The link works
            once, for 30 minutes.
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Nothing arrived after a few minutes? Check your spam folder, or try again.</p>
        <Link href="/sign-in" className={`mt-6 ${PRIMARY_BUTTON}`}>
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" lead="Enter the email address of your account and we will send you a link to choose a new password.">
      <form onSubmit={submit} aria-label="Reset your password" className="mt-6 space-y-4" noValidate>
        <TextField
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={state.status === 'busy' || !email.trim()} className={PRIMARY_BUTTON}>
          {state.status === 'busy' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'busy' ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      {state.status === 'error' && <Notice tone="error">{state.message}</Notice>}
      <p className="mt-5 text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/sign-in" className="font-medium text-primary underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}

export function ResetPasswordCard({ token }: { token: string | null }) {
  const [password, setPassword] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'done' } | { status: 'error'; message: string; field: 'password' | null; expired: boolean }>({
    status: 'idle',
  });

  if (!token) {
    return (
      <AuthCard title="This link is incomplete">
        <Notice tone="error">Open the link from your email again, or ask for a new one.</Notice>
        <Link href="/forgot-password" className={`mt-6 ${PRIMARY_BUTTON}`}>
          Ask for a new link
        </Link>
      </AuthCard>
    );
  }

  if (state.status === 'done') {
    return (
      <AuthCard title="Password changed">
        <Notice tone="success">Your new password is set, and every device was signed out. Sign in with your new password.</Notice>
        <Link href="/sign-in" className={`mt-6 ${PRIMARY_BUTTON}`}>
          Sign in
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
    const field = result.error.code?.startsWith('PASSWORD_') ? 'password' : null;
    setState({ status: 'error', message: authErrorMessage(result.error), field, expired: result.error.code === 'INVALID_TOKEN' });
  }

  const passwordError = state.status === 'error' && state.field === 'password' ? state.message : null;
  return (
    <AuthCard title="Choose a new password" lead="After this, you will be signed out on every device and can sign in with the new password.">
      <form onSubmit={submit} aria-label="Choose a new password" className="mt-6 space-y-4" noValidate>
        <PasswordField
          label="New password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          hint={PASSWORD_HINT}
          error={passwordError}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={state.status === 'busy' || password.length < 12} className={PRIMARY_BUTTON}>
          {state.status === 'busy' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'busy' ? 'Saving…' : 'Save new password'}
        </button>
      </form>
      {state.status === 'error' && !passwordError && <Notice tone="error">{state.message}</Notice>}
      {state.status === 'error' && state.expired && (
        <Link href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
          Ask for a new link
        </Link>
      )}
    </AuthCard>
  );
}
