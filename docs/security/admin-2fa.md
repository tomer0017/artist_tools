# Two-factor verification for administrators

**Built:** 2026-11-11. **State:** available and tested. **Not required yet.**
Making it required for every administrator (`ADMIN_MFA_REQUIRED=on`) needs
the owner's explicit approval, after the owner has enrolled and tried a
recovery code.

## Why it is built this way

Better Auth's two-factor plugin only intercepts **password** sign-ins
(`/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number`). The owner
signs in with **Google**, so with that plugin the second factor would never
be asked for. Instead, the check sits on **admin access itself**:

- An administrator who has enrolled must enter a code in every new session,
  before any admin page, server action or admin route works.
- It does not matter how they signed in.
- A verified session stays verified for 12 hours (or until it ends,
  whichever comes first).
- After a correct code the admin may **trust the device** (on by default,
  off on a shared computer): see "Trusted devices" below.
- The rest of the app (the studio, the account page) is not affected.

## Trusted devices (2026-11-23)

So the owner is not asked for a code every 12 hours on their own Mac and
iPhone, a device can be trusted after a correct code:

- **The token:** 32 random bytes in an HttpOnly, SameSite=Lax cookie that
  page scripts cannot read; over HTTPS it is `__Host-sc.admin_device`
  (Secure, path `/`, no domain: this exact host only). Only its SHA-256 is
  stored, in `admin_trusted_devices`, with the account, dates and a label
  ("Chrome on macOS", from the user agent, for the list only).
- **What it does:** an enrolled admin's session that has not passed yet
  passes without a code when the request carries a live token **for the
  same account**. It never replaces the session: a Google sign-in is still
  needed, and a stolen, expired or revoked session gets nothing. IP address
  and browser details never decide anything.
- **How long:** 30 days after the device was last used, and at most 90 days
  after the last code entered on it (a code on it again starts a new 90
  days, with the same token). The cookie lives 90 days; the server's record
  decides.
- **Ending it:** Admin → Security lists the trusted devices ("This device"
  marked), each with Forget, and Forget all. Turning 2FA off, the server
  reset (`reset-admin-mfa`) and losing the admin role forget every device.
  "Shared device? Sign out…" on the account page gives up this device's
  trust; a plain sign-out keeps it (the next sign-in there needs Google, not
  a code).
- **Audit log:** device trusted (or renewed with a code), passed on a trusted
  device (once per verified session), devices forgotten.
- `ADMIN_MFA_REQUIRED` is unchanged: it still only makes unenrolled admins
  enrol, and it is still off.

## How it works

| Part | Where |
|---|---|
| TOTP (RFC 6238): HMAC-SHA1, 6 digits, 30 s, ±1 step for clock drift; each code works once (the last used step is recorded, in the same write that accepts the code) | `src/server/security/totp.ts` |
| The secret, encrypted at rest with AES-256-GCM, using a key derived (HKDF) from `BETTER_AUTH_SECRET` | `src/server/security/secret-box.ts` |
| Enrolment, verification, recovery codes, lockout, turning off, reset | `src/server/admin-mfa.ts` |
| Where it is enforced: `requireAdmin()` for pages, which sends the admin to `/admin/verify`; `currentAdmin()` for server actions and admin routes, which refuse | `src/server/session.ts` |
| Pages | `/admin/security` (set up, manage) and `/admin/verify` (enter a code) |
| Data | `admin_mfa` (one per admin), `admin_mfa_sessions` (verified sessions; expire on their own), `admin_trusted_devices` (token hashes; expire on their own) |

- **Recovery codes:**
  - ten random codes (50 bits each), stored as SHA-256 hashes and shown once;
  - each works once, for verifying or for turning 2FA off;
  - making new ones needs a code from the authenticator app, and the old
    ones stop working.
- **Lockout:** after 5 wrong codes, all codes are refused for 15 minutes.
  Every failure is in the audit log.
- **Sensitive steps:** enrolling and turning off also need a sign-in within
  the last 10 minutes ("Confirm it is you"), like role changes.
- **Audit log** ("Passwords, methods and devices" group):
  - enrolled, verified (with authenticator or recovery code), wrong code;
  - new recovery codes, turned off, reset from the server.
- **Return path:** after verification the admin returns to where they were
  going. Only `/admin` paths are accepted, so this cannot be used to send
  someone to another site.

## Owner's steps to try it (staging)

1. Install an authenticator app on the iPhone. Apple Passwords already
   supports codes: Settings → Passwords. Google Authenticator or 1Password
   also work.
2. Admin → **Security** → **Set up two-factor verification**. You may be
   asked to confirm it is you with Google first.
3. On the iPhone, tap **Open in an authenticator app**. On a computer, scan
   the QR code with the phone. Then enter the 6-digit code.
4. **Save the ten recovery codes** somewhere away from the phone (a password
   manager, or printed). Download them as a text file if that helps.
5. Sign out and sign in again: the admin dashboard now asks for a code.
6. Try a recovery code once, with "Lost your phone? Use a recovery code".
   Then make new codes on the Security page.
7. Only then, if you want it required for every administrator, approve
   setting `ADMIN_MFA_REQUIRED=on` on the server.

## If the phone and the codes are lost

On the server, run as root in the release directory:

```
npm run db -- reset-admin-mfa <userId>
```

This removes that admin's two-factor setup, so they sign in and enrol again.
It is recorded in the audit log.

**Rotating `BETTER_AUTH_SECRET`** also makes the stored secrets unreadable.
Every enrolled admin then needs this reset.

## Tests

- **`src/server/admin-mfa.test.ts`:**
  - the RFC 6238 test vectors;
  - clock drift, and refusing a code used before;
  - encryption, tampering and the wrong key;
  - enrolment, the gate, recovery codes (single use, any case and spacing);
  - the lockout and its expiry;
  - replacing codes and turning off;
  - the operator's reset.
- **`src/server/admin-mfa.test.ts`, trusted devices:** the token for its own
  account only, never stored; 30 days unused and the 90-day cap; renewal
  with a code; a session's own end; forgetting one, all, by token, with 2FA
  off and with the admin role gone.
- **`e2e/admin-mfa.spec.ts`, with seven sessions of one admin:**
  - set up with a wrong code first, then a right one; ten codes;
  - another session sent to verify before analytics;
  - the export route refused (404) until it verifies;
  - a recovery code works once;
  - a trusted device: a new session there needs no code, one elsewhere does,
    and a forgotten device's old cookie no longer counts;
  - turning it off.
  - Repeated five times in a row: 20/20.

## Found while building it

**The problem.** The setup action sometimes never finished in the browser.
A server action that reads the session made Better Auth renew the session
cookie, through `nextCookies()`. Any cookie written inside a server action
makes Next.js re-render the whole page into the action's reply. When that
reply arrived while the admin tabs were still being prefetched, the action's
promise sometimes never resolved.

**The fix.** Server actions now read the session without renewing cookies
(`src/server/session.ts`). Page loads still renew sessions as people use
the site. Every action reply is now small, without a page re-render.
