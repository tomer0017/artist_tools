// The trusted-device lengths for the pages (the server's own are in
// src/server/admin-mfa.ts, which client components cannot import); a unit
// test keeps both the same.
export const TRUST_IDLE_DAYS = 30;
export const TRUST_MAX_DAYS = 90;
