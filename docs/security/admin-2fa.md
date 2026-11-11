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
- The rest of the app (the studio, the account page) is not affected.

## How it works

| Part | Where |
|---|---|
| TOTP (RFC 6238): HMAC-SHA1, 6 digits, 30 s, ±1 step for clock drift; each code works once (the last used step is recorded, in the same write that accepts the code) | `src/server/security/totp.ts` |
| The secret, encrypted at rest with AES-256-GCM, using a key derived (HKDF) from `BETTER_AUTH_SECRET` | `src/server/security/secret-box.ts` |
| Enrolment, verification, recovery codes, lockout, turning off, reset | `src/server/admin-mfa.ts` |
| Where it is enforced: `requireAdmin()` for pages, which sends the admin to `/admin/verify`; `currentAdmin()` for server actions and admin routes, which refuse | `src/server/session.ts` |
| Pages | `/admin/security` (set up, manage) and `/admin/verify` (enter a code) |
| Data | `admin_mfa` (one per admin), `admin_mfa_sessions` (verified sessions; expire on their own) |

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
- **`e2e/admin-mfa.spec.ts`, with four sessions of one admin:**
  - set up with a wrong code first, then a right one; ten codes;
  - another session sent to verify before analytics;
  - the export route refused (404) until it verifies;
  - a recovery code works once;
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
