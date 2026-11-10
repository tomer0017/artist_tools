'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AuthCard, Notice, PasswordField, TextField } from './AuthCard';
import { PASSWORD_HINT, PRIMARY_BUTTON, authErrorMessage, verifiedReturn } from './ui';

// Create an account with an email address and a password. The server answers
// every accepted request the same way (new, already registered or not
// invited), so this page always ends on "check your email": only the owner of
// the address learns which it was, from the email they receive.

export default function SignUpCard({ callbackPath, registration }: { callbackPath: string; registration: 'open' | 'invite' }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<
    { status: 'idle' | 'busy' } | { status: 'sent'; email: string } | { status: 'error'; message: string; field: 'password' | null }
  >({ status: 'idle' });
  const signIn = `/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ status: 'busy' });
    const address = email.trim();
    const result = await authClient.signUp.email({ name: name.trim(), email: address, password, callbackURL: verifiedReturn(callbackPath) });
    if (!result.error) {
      setPassword('');
      setState({ status: 'sent', email: address });
      return;
    }
    setState({ status: 'error', message: authErrorMessage(result.error), field: result.error.code?.startsWith('PASSWORD_') ? 'password' : null });
  }

  if (state.status === 'sent') {
    return (
      <AuthCard title="Check your email">
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p role="status" className="text-sm leading-relaxed text-foreground">
            We have sent a message to <strong className="break-all">{state.email}</strong>. Open the link in it to confirm your address and finish
            creating your account. The link works for 24 hours.
          </p>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {registration === 'invite'
            ? 'Studio Companion is invite-only while we test it: if this address is not invited yet, no account is created. '
            : ''}
          Already have an account with this address? The email tells you how to sign in. Nothing arrived after a few minutes? Check your spam folder.
        </p>
        <Link href={signIn} className={`mt-6 ${PRIMARY_BUTTON}`}>
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  const passwordError = state.status === 'error' && state.field === 'password' ? state.message : null;
  return (
    <AuthCard
      title="Create your free account"
      lead={
        registration === 'invite'
          ? 'Studio Companion is invite-only while we test it. Use the email address you were invited with.'
          : 'All five tools, free with no time limit. We will email you a link to confirm your address.'
      }
    >
      <form onSubmit={submit} aria-label="Create an account" className="mt-6 space-y-4" noValidate>
        <TextField label="Your name" name="name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
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
        <PasswordField
          label="Password"
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
        <button type="submit" disabled={state.status === 'busy' || !name.trim() || !email.trim() || password.length < 12} className={PRIMARY_BUTTON}>
          {state.status === 'busy' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {state.status === 'busy' ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      {state.status === 'error' && !passwordError && <Notice tone="error">{state.message}</Notice>}
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Creating an account never subscribes you to marketing emails. You can choose that later on your account page.
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href={signIn} className="font-medium text-primary underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
