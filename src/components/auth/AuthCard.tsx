'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { Eye, EyeOff } from 'lucide-react';
import { LanguageSwitch } from '@/components/common/LanguageSwitch';
import { BrandMark } from '@/components/shell/BrandMark';
import { localizedPath } from '@/i18n/config';

// Shared pieces of the sign-in, sign-up and password pages: the card, labelled
// fields sized for phones (16 px text, so iOS does not zoom on focus), and
// plain-language messages for the server's error codes.

export function AuthCard({ title, lead, children }: { title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  const t = useTranslations('common');
  const locale = useLocale();
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
        <div className="flex items-start justify-between gap-3">
          <Link href={localizedPath('/', locale)} aria-label={t('home')} className="inline-block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark />
          </Link>
          <LanguageSwitch />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {lead && <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{lead}</div>}
        {children}
      </div>
    </main>
  );
}

const INPUT =
  'mt-1.5 block h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive';

export function TextField({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string | null; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={described} className={INPUT} {...input} />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A password input with a show/hide button. */
export function PasswordField({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string | null; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`${INPUT} pe-12`}
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('hidePassword') : t('showPassword')}
          aria-pressed={visible}
          className="absolute end-1 top-1/2 mt-[3px] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'info' | 'success'; children: React.ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-destructive/40 bg-destructive/10'
      : tone === 'success'
        ? 'border-primary/40 bg-primary/10'
        : 'border-border bg-secondary/50';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`mt-5 rounded-lg border px-3 py-2 text-sm text-foreground ${styles}`}>
      {children}
    </p>
  );
}
