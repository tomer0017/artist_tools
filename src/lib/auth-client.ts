import { createAuthClient } from 'better-auth/client';

// Browser side of authentication: starts Google sign-in and signs out. It
// holds no secrets and decides nothing — the server verifies every request.
export const authClient = createAuthClient();
