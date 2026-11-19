'use client';

import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountSummary, ToolId } from '@/lib/account';
import { clearDeviceWork } from '@/lib/device-data';
import { TOOL_FEATURES, type FeatureId } from '@/lib/plans';
import { signInPath } from '@/lib/redirects';
import { accountIdentity } from '@/lib/username';
import { pathForView } from './tools';

/** Who is signed in and what their account may use, as the server last reported it. */
export type StudioAccount = AccountSummary;

interface AccountState {
  account: StudioAccount;
  /** Re-read the account from the server (/api/me). */
  refresh: () => Promise<void>;
  /** Take a copy the server sent with a page (AccountSync); an older copy than the one held is ignored. */
  receive: (account: StudioAccount) => void;
  /** Remember (on the account) that a tool's first-visit introduction was dismissed. */
  markIntroSeen: (tool: ToolId) => void;
  /** Show every tool's introduction again. */
  resetIntros: () => Promise<boolean>;
}

const AccountContext = createContext<AccountState | null>(null);

/** While the studio is in view, the account is re-read this often (a plan change, a newly published catalog). */
export const ACCOUNT_CHECK_MS = 60_000;
/** Coming back to the studio re-reads the account if the last copy is older than this. */
const RETURN_CHECK_MS = 10_000;
/** Tabs of the same account tell each other when what it may use changes. */
const CHANNEL = 'studio-account';

/** Whether two copies of the account differ in what it may use (worth telling the other tabs). */
const accessKey = (a: StudioAccount) => JSON.stringify([a.role, a.access, a.plan, [...a.features].sort(), a.offer, a.quotas, a.learn?.key ?? null]);

/**
 * Holds the account the server rendered the studio with, and keeps it current,
 * so a plan or role change made by an admin, or a newly published plan
 * catalog, reaches an open studio without signing in again: every navigation
 * inside the studio brings a fresh copy from the server (AccountSync); while
 * the studio is in view it asks every minute, and again when it comes back
 * into view; and an open tab tells the account's other tabs as soon as it
 * learns of a change. A copy older than the one held never replaces it. If
 * the session has ended, it sends the person to sign in and back to where
 * they were; if the browser is now signed in to another account, the page
 * reloads as that account.
 */
export function AccountProvider({ initial, children }: { initial: StudioAccount; children: React.ReactNode }) {
  const [account, setAccount] = useState(initial);
  const current = useRef(initial);
  const lastCheck = useRef(Date.now());
  const channel = useRef<BroadcastChannel | null>(null);

  const apply = useCallback((next: StudioAccount, tellOtherTabs: boolean) => {
    const held = current.current;
    if (next.id !== held.id || Date.parse(next.asOf) <= Date.parse(held.asOf)) return;
    current.current = next;
    lastCheck.current = Date.now();
    setAccount(next);
    if (tellOtherTabs && accessKey(next) !== accessKey(held)) channel.current?.postMessage({ type: 'account', account: next });
  }, []);

  const refresh = useCallback(async () => {
    lastCheck.current = Date.now();
    try {
      const response = await fetch('/api/me?check=1', { cache: 'no-store', credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign(signInPath(window.location.pathname));
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as { user: StudioAccount };
      if (body.user.id !== current.current.id) {
        window.location.reload();
        return;
      }
      apply(body.user, true);
    } catch {
      // Offline or the server is restarting: keep the server's last answer.
    }
  }, [apply]);

  const receive = useCallback((next: StudioAccount) => apply(next, true), [apply]);

  useEffect(() => {
    const inView = () => document.visibilityState === 'visible';
    const onReturn = () => {
      if (inView() && Date.now() - lastCheck.current > RETURN_CHECK_MS) void refresh();
    };
    const timer = window.setInterval(() => {
      if (inView() && Date.now() - lastCheck.current >= ACCOUNT_CHECK_MS - 1_000) void refresh();
    }, ACCOUNT_CHECK_MS);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [refresh]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const tabs = new BroadcastChannel(CHANNEL);
    channel.current = tabs;
    tabs.onmessage = (event: MessageEvent<{ type?: string; account?: StudioAccount }>) => {
      if (event.data?.type === 'account' && event.data.account) apply(event.data.account, false);
    };
    return () => {
      tabs.close();
      channel.current = null;
    };
  }, [apply]);

  const markIntroSeen = useCallback((tool: ToolId) => {
    // Shown as dismissed at once, and on this device even if saving fails.
    rememberIntroLocally(initial.id, tool);
    setAccount((a) => (a.introsSeen.includes(tool) ? a : { ...a, introsSeen: [...a.introsSeen, tool] }));
    void fetch('/api/me/intros', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool }),
      credentials: 'same-origin',
    })
      .then((response) => response.text())
      .catch(() => {});
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

  const value = useMemo(() => ({ account, refresh, receive, markIntroSeen, resetIntros }), [account, refresh, receive, markIntroSeen, resetIntros]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

/** Hands the studio the account a server page sent with this navigation (read from the database just now). Renders nothing. */
export function AccountSync({ account }: { account: StudioAccount }) {
  const receive = useContext(AccountContext)?.receive;
  useEffect(() => {
    receive?.(account);
  }, [account, receive]);
  return null;
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
 * Whether the account includes a feature — the server's latest decision, for
 * what the studio offers. Saves and exports are authorized by the server again
 * when they happen (src/components/common/SaveMedia.tsx).
 */
export function useHasFeature(feature: FeatureId): boolean {
  const state = useContext(AccountContext);
  return state ? state.account.features.includes(feature) : false;
}

const NO_LEARN: StudioAccount['learn'] = { visible: false, modules: { curriculum: null, color: null, challenges: null }, key: 'none' };

/** What the studio shows of Learn (ADR-0018): whether it appears at all, and each collection as open, locked or absent. */
export function useLearnSummary(): StudioAccount['learn'] {
  return useContext(AccountContext)?.account.learn ?? NO_LEARN;
}

/** Whether the account may open each tool now (the server's latest decision); no account: nothing opens. */
export function useToolAllowed(): (tool: ToolId) => boolean {
  const features = useContext(AccountContext)?.account.features;
  return useCallback((tool: ToolId) => features?.includes(TOOL_FEATURES[tool]) === true, [features]);
}

/**
 * Sign out on the server, then leave the studio with a full page load
 * (dropping everything it held in memory). `clearDevice` also removes the
 * work kept in this browser, for shared devices.
 */
export function useSignOut() {
  const [signingOut, setSigningOut] = useState(false);
  const signOut = useCallback(async (options?: { clearDevice?: boolean }) => {
    setSigningOut(true);
    // Loaded on demand: the auth client is only needed for this one click.
    const { authClient } = await import('@/lib/auth-client');
    const { error } = await authClient.signOut();
    if (error) {
      setSigningOut(false);
      return;
    }
    if (options?.clearDevice) clearDeviceWork();
    window.location.assign(new URL('/', window.location.origin));
  }, []);
  return { signingOut, signOut };
}

/** The profile picture (from Google), or the person's initials when there is none (or it fails to load). */
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
  const t = useTranslations('studio');
  if (!state) return null;
  return (
    <Link
      href={pathForView('profile')}
      data-account-ui
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/60 ring-1 ring-border/70 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AccountAvatar account={state.account} size={32} />
      <span className="sr-only">{t('yourAccount')}</span>
    </Link>
  );
}

/** "Signed in as … · Plans · Sign out", under the Home screen. */
export function AccountLine() {
  const state = useAccount();
  const { signingOut, signOut } = useSignOut();
  const t = useTranslations();
  if (!state) return null;

  return (
    <p data-account-line className="mt-2 px-4 text-center text-xs text-muted-foreground md:px-6">
      {t.rich('studio.signedInAs', {
        email: accountIdentity(state.account),
        // An address reads left to right inside Hebrew text too.
        addr: (chunks) => (
          <span dir="ltr" className="text-foreground/80">
            {chunks}
          </span>
        ),
      })}
      {' · '}
      <Link href={pathForView('plans')} className="font-medium text-primary underline-offset-2 hover:underline">
        {t('common.plans')}
      </Link>
      {' · '}
      <button
        type="button"
        onClick={() => signOut()}
        disabled={signingOut}
        className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {signingOut ? t('studio.signingOut') : t('studio.signOut')}
      </button>
    </p>
  );
}
