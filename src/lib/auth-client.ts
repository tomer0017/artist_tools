import { createAuthClient } from 'better-auth/client';

// Browser side of authentication: starts Google sign-in, signs in with a
// username where the server offers it, and signs out. It holds no secrets and
// decides nothing — the server verifies every request.
export const authClient = createAuthClient();

/**
 * Username sign-in (POST /api/auth/sign-in/username), for accounts an
 * administrator created; the server answers 404 where it is off. Errors come
 * back as `{ code, status }` like every other call of the client.
 */
export async function signInWithUsername(body: { username: string; password: string }): Promise<{ error: { code?: string; status?: number; message?: string } | null }> {
  const result = await authClient.$fetch('/sign-in/username', { method: 'POST', body });
  return { error: (result as { error?: { code?: string; status?: number; message?: string } | null }).error ?? null };
}
