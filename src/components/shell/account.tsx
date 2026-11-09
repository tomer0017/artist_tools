'use client';

import { createContext, useContext, useState } from 'react';

/** Who is signed in, as given to the studio by the server (display only). */
export interface StudioAccount {
  name: string;
  email: string;
  image: string | null;
}

const AccountContext = createContext<StudioAccount | null>(null);
export const AccountProvider = AccountContext.Provider;

/** "Signed in as … · Sign out", under the Home screen. */
export function AccountLine() {
  const account = useContext(AccountContext);
  const [signingOut, setSigningOut] = useState(false);
  if (!account) return null;

  async function signOut() {
    setSigningOut(true);
    // Loaded on demand: the auth client is only needed for this one click.
    const { authClient } = await import('@/lib/auth-client');
    const { error } = await authClient.signOut();
    if (error) {
      setSigningOut(false);
      return;
    }
    // A full page load drops everything the studio held in memory.
    window.location.assign(new URL('/', window.location.origin));
  }

  return (
    <p data-account-line className="mt-2 px-4 text-center text-xs text-muted-foreground md:px-6">
      Signed in as <span className="text-foreground/80">{account.email}</span>
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
