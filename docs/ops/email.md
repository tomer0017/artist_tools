# Account email: setting up real delivery

**Written:** 2026-11-15.

**Since 2026-11-16, staging signs in with Google only.** That needs no email at all. This guide applies when email and password sign-in comes back.

**Status:**
- The code can send through any email provider's SMTP server, always over TLS.
- **Staging still uses the outbox.** No email reaches anyone: confirmations and resets wait at `/admin/mail`.
- Public registration stays closed until real delivery has been checked. The configuration refuses open registration with the outbox, outside development and tests.

## 1. Choose a sender

Any provider works if it does two things:
- it lets you send from an address you control, with SPF and DKIM;
- it offers SMTP on port 465 or 587.

On 2026-11-15 the providers below were reachable from the VPS (over IPv4, which the mailer uses first). Their free allowances change, so check the current terms when you sign up.

| Option | What you need | Free allowance (check) | Good for |
|---|---|---|---|
| **A. Own domain + Resend** | A domain (a purchase, typically $10–20 a year) and access to its DNS | About 3,000 a month, 100 a day | Launch: a sender with your name, proper SPF/DKIM/DMARC |
| **B. Own domain + Brevo** | The same domain and DNS | About 300 a day | The same; an EU company |
| **C. A new Gmail account for the app** | Nothing to buy | Gmail's sending limit, about 500 a day | Staging now: the quickest; the sender shows as …@gmail.com |

**Recommendation:** C to open staging now. Then A (or B) before production, which needs its own domain anyway for its address, legal pages and email.

Don't use your personal Gmail: every person who signs up would see that address.

## 2. Create the provider credentials

**Option C, Gmail:**
1. Create a new Google account for the app (any free name).
2. Turn on 2-Step Verification: https://myaccount.google.com/signinoptions/twosv
3. Create an app password at https://myaccount.google.com/apppasswords, named "Studio Companion staging". Google shows 16 letters once.
4. The answers for step 3 below:
   - server `smtp.gmail.com`, port `465`;
   - username: the full Gmail address;
   - sender: `Studio Companion <that address>`;
   - password: the 16 letters (spaces don't matter).

**Option A, Resend:**
1. Add the domain under **Domains** and create the DNS records Resend shows (SPF and DKIM).
2. Add a DMARC record too: `_dmarc` TXT `v=DMARC1; p=none`.
3. Under **API Keys**, create a key with **Sending access** for that domain only.
4. The answers for step 3 below:
   - server `smtp.resend.com`, port `465`;
   - username `resend`;
   - sender `Studio Companion <hello@your-domain>`;
   - password: the API key.

**Option B, Brevo:**
1. Authenticate the domain under **Senders, domains**.
2. Use the SMTP login and an SMTP key from **SMTP & API**.
3. Server `smtp-relay.brevo.com`, port `587`.

## 3. Put them on the server

The credentials never go through the chat. Connect to the server as `studio-admin`, then run:

```
sudo studio-set-mail staging
```

Answer the five questions; the password is hidden as you type. The script:
- writes the settings into `/etc/studio-companion/staging.env`;
- keeps the previous version as `staging.env.previous`;
- restarts nothing and doesn't open registration.

Then send yourself a test message:

```
sudo studio-mail-test staging you@example.com        # add "he" for the Hebrew one
```

It connects and signs in over TLS, then sends one message. If the provider refuses, the message says why (for example, a wrong password). Check that the message arrives, and not in spam.

**To undo:**

```
sudo cp -p /etc/studio-companion/staging.env.previous /etc/studio-companion/staging.env
```

## 4. What happens next (with your go-ahead)

1. **Restart staging.** From then on, account email is really sent.
2. **Check email and password:** sign up, receive the confirmation, follow it and get signed in, then reset the password.
3. **Check Google.** In Google Cloud, under **Google Auth Platform → Audience**, the publishing status must be **In production**. In "Testing", only the test users listed there can sign in.
   - The app asks only for `openid`, `email` and `profile`, which need no Google review.
   - Adding a logo to the consent screen would start a brand review, so leave it out for now.

   Then sign up with a Google account that has never used the app.
4. **Open registration:**
   - set `AUTH_SIGNUP_MODE="open"`;
   - restart;
   - run the health check and `deploy/smoke.sh`;
   - check that the sign-in and sign-up pages no longer mention invitations.

To close registration again: `AUTH_SIGNUP_MODE="invite"` and restart. Existing accounts keep working either way.

## Protection while registration is open

- **Per network address:**
  - 5 email sign-ups per 10 minutes;
  - 10 Google sign-in starts and 20 returns per minute;
  - 5 password sign-ins per minute.
- **Per email address:**
  - 3 messages of a kind per hour and 10 per day;
  - 10 wrong passwords pause password sign-in for 15 minutes.
- **For everyone together:**
  - more than 50 new accounts in an hour, or 300 in a day, pauses sign-ups until the window ends;
  - every address gets the same answer;
  - existing accounts still sign in;
  - the pause appears in the admin activity log.
- **Unconfirmed accounts:**
  - an email sign-up can't be used until its address is confirmed;
  - unconfirmed ones are deleted after 24 hours (nightly maintenance).
- **New accounts:**
  - always role `user`, on Free;
  - admin access is granted only by id, from the server or by another admin, never from an email address.
