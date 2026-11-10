'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountSummary, ToolId } from '@/lib/account';
import type { FeatureId } from '@/lib/plans';
import { signInPath } from '@/lib/redirects';
import { pathForView } from './tools';

/** Who is signed in and what their account includes, as the server reported it (display only). */
export type StudioAccount = AccountSummary;

interface AccountState {
  account: StudioAccount;
  /** Re-read the account from the server (/api/me). */
  refresh: () => Promise<void>;
  /** Remember (on the account) that a tool's first-visit introduction was dismissed. */
  markIntroSeen: (tool: ToolId) => void;
  /** Show every tool's introduction again. */
  resetIntros: () => Promise<boolean>;
}

const AccountContext = createContext<AccountState | null>(null);

/** Coming back to the studio re-reads the account at most this often. */
const REFRESH_AFTER_MS = 30_000;

/**
 * Holds the account the server rendered the studio with, and keeps it current:
 * a plan or role change made by an admin shows up when the studio comes back
 * into view (or the profile opens). If the session has ended, it sends the
 * person to sign in and back to where they were.
 */
export function AccountProvider({ initial, children }: { initial: StudioAccount; children: React.ReactNode }) {
  const [account, setAccount] = useState(initial);
  const lastRefresh = useRef(Date.now());

  const refresh = useCallback(async () => {
    lastRefresh.current = Date.now();
    try {
      const response = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign(signInPath(window.location.pathname));
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as { user: StudioAccount };
      setAccount(body.user);
    } catch {
      // Offline or the server is restarting: keep what we have.
    }
  }, []);

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > REFRESH_AFTER_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [refresh]);

  const markIntroSeen = useCallback((tool: ToolId) => {
    // Shown as dismissed at once, and on this device even if saving fails.
    rememberIntroLocally(initial.id, tool);
    setAccount((a) => (a.introsSeen.includes(tool) ? a : { ...a, introsSeen: [...a.introsSeen, tool] }));
    void fetch('/api/me/intros', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool }),
      credentials: 'same-origin',
    }).catch(() => {});
  }, [initial.id]);

  const resetIntros = useCallback(async () => {
    try {
      const response = await fetch('/api/me/intros', { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) return false;
      forgetIntrosLocally(initial.id);
      setAccount((a) => ({ ...a, introsSeen: [] }));
      return true;
    } catch {
      return false;
    }
  }, [initial.id]);

  const value = useMemo(() => ({ account, refresh, markIntroSeen, resetIntros }), [account, refresh, markIntroSeen, resetIntros]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

// A per-device copy of dismissed introductions (keyed by account), so one is
// never shown twice here even if telling the server failed.
const introKey = (userId: string, tool: ToolId) => `studio-intro-seen:${userId}:${tool}`;

export function introSeenLocally(userId: string, tool: ToolId): boolean {
  try {
    return localStorage.getItem(introKey(userId, tool)) === '1';
  } catch {
    return false;
  }
}

function rememberIntroLocally(userId: string, tool: ToolId) {
  try {
    localStorage.setItem(introKey(userId, tool), '1');
  } catch {
    // Private mode or storage full: the account still remembers it.
  }
}

function forgetIntrosLocally(userId: string) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(`studio-intro-seen:${userId}:`)) localStorage.removeItem(key);
  } catch {
    // Nothing stored here.
  }
}

export const useAccount = () => useContext(AccountContext);

/**
 * Whether the account includes a feature — a copy of the server's decision,
 * for showing locks. The server checks again before the feature is used.
 */
export function useHasFeature(feature: FeatureId): boolean {
  const state = useContext(AccountContext);
  return state ? state.account.features.includes(feature) : false;
}

/** Sign out on the server, then leave the studio with a full page load (dropping everything it held in memory). */
export function useSignOut() {
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useCallback(async () => {
    setSigningOut(true);
    // Loaded on demand: the auth client is only needed for this one click.
    const { authClient } = await import('@/lib/auth-client');
    const { error } = await authClient.signOut();
    if (error) {
      setSigningOut(false);
      return;
    }
    window.location.assign(new URL('/', window.location.origin));
  }, []);
  return { signingOut, signOut };
}

/** The Google profile picture, or the person's initials when there is none (or it fails to load). */
export function AccountAvatar({ account, size = 32 }: { account: Pick<StudioAccount, 'name' | 'email' | 'image'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = (account.name || account.email)
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (account.image && !failed) {
    return (
      <img
        src={account.image}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}

/** The way into the account page: the person's avatar, top right. */
export function AccountButton() {
  const state = useAccount();
  if (!state) return null;
  return (
    <Link
      href={pathForView('profile')}
      aria-label="Your account"
      data-account-ui
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/60 ring-1 ring-border/70 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AccountAvatar account={state.account} size={32} />
    </Link>
  );
}

/** "Signed in as … · Plans · Sign out", under the Home screen. */
export function AccountLine() {
  const state = useAccount();
  const { signingOut, signOut } = useSignOut();
  if (!state) return null;

  return (
    <p data-account-line className="mt-2 px-4 text-center text-xs text-muted-foreground md:px-6">
      Signed in as <span className="text-foreground/80">{state.account.email}</span>
      {' · '}
      <Link href={pathForView('plans')} className="font-medium text-primary underline-offset-2 hover:underline">
        Plans
      </Link>
      {' · '}
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </p>
  );
}
