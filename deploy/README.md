# Deploying Studio Companion on the VPS

Each environment (staging, production) is one CloudPanel **Node.js site**
(nginx vhost + Let's Encrypt certificate, managed in the panel) in front of the
Next.js standalone server, which runs under **systemd** as the site's user and
listens on `127.0.0.1` only.

## One-time setup per environment

1. CloudPanel → Add Site → Node.js (or `clpctl site:add:nodejs`): the domain,
   Node.js 24, an app port (e.g. 3000) and a site user. Issue a Let's Encrypt
   certificate for the domain.
2. `/etc/studio-companion/<env>.conf` (root, 0644):

   ```sh
   APP_USER=studio-staging
   APP_DIR=/home/studio-staging/app
   PORT=3000
   NODE_BIN=/home/studio-staging/.nvm/versions/node/v24.x.y/bin
   REPO_URL=https://github.com/tomer0017/artist_tools.git
   ```

3. `/etc/studio-companion/<env>.env` (owner `root:<APP_USER>`, mode `0640`):
   every variable in `.env.example`, with this environment's own values.
   `BETTER_AUTH_URL` is the site's `https://` address.
4. Install `deploy/studio-companion.service` as
   `/etc/systemd/system/studio-companion-<env>.service`, replacing `@ENV@`,
   `@APP_USER@`, `@APP_DIR@`, `@PORT@` and `@NODE_BIN@`; `systemctl daemon-reload`
   and `systemctl enable studio-companion-<env>`.

## Google sign-in credentials

Install the server side once (as root): `install -m 700 deploy/install-google-oauth.sh /usr/local/sbin/studio-set-google-oauth`.
Then, on your own computer, from the repository:

```sh
bash deploy/set-google-oauth.sh staging
```

It asks for the Client ID, the Client Secret (hidden) and the Google
account(s) allowed to create accounts (`AUTH_SIGNUP_ALLOWLIST`), and sends them
over SSH into `/etc/studio-companion/<env>.env`. Nothing is printed, other
variables are kept, the previous file is saved as `<env>.env.previous`, and
nothing restarts until you run `systemctl restart studio-companion-<env>`.
Registration stays invite-only: an empty allowlist means no new accounts.

### Username sign-in for invited testers

Accounts that an admin creates for testers sign in with a username and a
password: no Google account, no email, and no sign-up (ADR-0012). It is off
unless `AUTH_USERNAME_PASSWORD=on`. Install the server side once (as root):
`install -m 700 deploy/install-username-login.sh /usr/local/sbin/studio-set-username-login`.
Then, on the server:

```sh
sudo studio-set-username-login staging on    # or off
```

It changes only that line (the previous file is kept as `<env>.env.previous`),
restarts the app and puts the old file back if it does not come back healthy.
Off, username accounts cannot sign in but are kept with their data.

Creating accounts: in the admin dashboard (**Users → New tester account**, the
password is shown once), or on the server, which never prints the password:

```sh
cd /home/studio-staging/app/current
sudo runuser -u studio-staging -- bash -c 'set -a; . /etc/studio-companion/staging.env; set +a; npm run --silent db -- create-tester Tomerfree free'
```

The initial password can then be revealed once in the dashboard (the account →
**Reveal initial password**) for 72 hours; after that, **Reset password** makes
a new one. `create-tester` does nothing to a username that exists.
`npm run db -- login-test` checks username sign-in end to end over the
environment's own URL with a temporary account it removes afterwards, and
`npm run db -- remove-tester <username>` deletes a username account.

### Checking what each plan may use (ADR-0013)

`npm run db -- entitlement-test` checks, over the environment's own URL, that
a temporary Free account and a temporary Pro account get exactly what the
published plan catalog gives them: every tool allowed or refused, every
export, what the studio is told, and a plan change on the same session. The
accounts are removed afterwards; nothing secret is printed. With
`--publish-check` it changes published entitlements for real: it records the
live version and its exact content (printed with a fingerprint), publishes a
temporary version over exactly that version (Create a Grid off for everyone;
Free gains Measure & Plan, Compare & Correct and GIFs, and loses saving
images), checks both accounts against it, and then publishes the recorded
content again as a new version, over the temporary one only. If an admin
published or opened a draft in the meantime, nothing of theirs is
overwritten: the restore stops and says what to do. At the end the live
content and the `plans` documents must equal the record. Both versions are
audited and listed in Admin → Plans. It refuses to start while a catalog
draft exists.

`--hold <seconds>` (at most 600) keeps the temporary version that long, or
until a line arrives on standard input, so a studio left open in a browser
can be watched following it.

For a check in a real browser, `npm run db -- temp-testers create` makes
temporary username accounts (Free, Pro, and Free in Hebrew) and writes their
passwords to standard output, which must be a pipe or a file (it refuses a
terminal):

```sh
ssh root@<server> 'cd /home/studio-staging/app/current && runuser -u studio-staging -- bash -c "set -a; . /etc/studio-companion/staging.env; set +a; npm run --silent db -- temp-testers create"' > temp-testers.json  # chmod 600; delete after
```

Remove them afterwards with `npm run db -- temp-testers remove`.

### Changing who may create an account

Install the server side once (as root): `install -m 700 deploy/install-invites.sh /usr/local/sbin/studio-set-invites`.
Then, on your own computer:

```sh
bash deploy/set-invites.sh staging
```

Enter the complete list, comma-separated. It replaces only
`AUTH_SIGNUP_ALLOWLIST` (no secret is asked for), keeps the previous file as
`<env>.env.previous`, restarts the app and waits for it to be healthy, and
puts the old list back if it is not. Addresses left out can no longer sign
up; existing accounts always keep working.

### Google-only public sign-in (staging since 2026-11-16)

Anyone whose Google account has a Google-verified address can sign in, and
the first sign-in creates their free account. There is no separate
registration and no email at all:

```sh
AUTH_SIGNUP_MODE="open"
AUTH_EMAIL_PASSWORD="off"
MAIL_TRANSPORT="disabled"
```

With passwords off:
- the password endpoints answer 404;
- `/sign-up`, `/forgot-password` and `/reset-password` lead to sign-in;
- the account page shows no password settings;
- `deploy/smoke.sh` checks all of this.

The code stays. Turning passwords back on needs real email first
(`docs/ops/email.md`).

### Opening public registration (only when approved)

Staging stays invite-only until real email works: the configuration refuses
`AUTH_SIGNUP_MODE="open"` with `MAIL_TRANSPORT="outbox"` (outside development
and tests), because real people's confirmation and reset links must be
emailed to them, never kept for admins to read. Set up email first (below and
`docs/ops/email.md`). Then add `AUTH_SIGNUP_MODE="open"` to
`/etc/studio-companion/<env>.env` (back up the file first) and
`systemctl restart studio-companion-<env>`, then check `/api/health?ready=1`. New accounts are always role `user` on Free;
admin access is never granted automatically. To close it again, set
`AUTH_SIGNUP_MODE="invite"` and restart. The sign-in, landing and plans pages
follow the setting on their own.

### Email and password sign-in

Off unless `AUTH_EMAIL_PASSWORD="on"`, and it always needs a mail transport.
There is no real mail provider yet (it needs a domain and the owner's
approval, docs/adr/0004), so **staging** uses the outbox:

```sh
APP_ENV="staging"
AUTH_EMAIL_PASSWORD="on"
MAIL_TRANSPORT="outbox"
```

Account emails (confirmations, resets, notices) are then kept for 24 hours
instead of sent, and admins read them at `/admin/mail` ("Test mail"). The
configuration refuses `MAIL_TRANSPORT="outbox"` unless `APP_ENV` is
development, test or staging, so a production server cannot start with it
(the health check fails and the release is switched back). The invite gate
applies to email sign-ups exactly as to Google ones. To turn it off: set
`AUTH_EMAIL_PASSWORD="off"` and restart; password accounts then cannot sign
in until it is on again (their data is kept).

### Real email (an SMTP provider)

Install the server side once (as root):

```sh
install -m 700 deploy/install-mail.sh /usr/local/sbin/studio-set-mail
install -m 755 deploy/mail-test.sh /usr/local/sbin/studio-mail-test
```

`sudo studio-set-mail <env>` asks for the provider's SMTP server, port, username, sender and
password (hidden) and writes `MAIL_TRANSPORT="smtp"` with them, keeping the
rest of the file and a `.previous` copy; nothing restarts. `sudo studio-mail-test <env> <address>`
then connects, signs in over TLS and sends one test message, before the app
uses it. Restart to switch the app over. Providers and their settings:
`docs/ops/email.md`.

### Nightly maintenance

Removes password sign-ups never confirmed within 24 hours and prunes idle
rate-limit rows. Install once per environment (as root):

```sh
install -m 755 deploy/maintenance.sh /usr/local/sbin/studio-maintenance
echo '20 3 * * * root /usr/local/sbin/studio-maintenance staging' > /etc/cron.d/studio-maintenance
chmod 0644 /etc/cron.d/studio-maintenance     # cron ignores group/world-writable files
```

Output goes to syslog: `journalctl -t studio-maintenance-staging`.

## Releasing

```sh
sudo deploy/release.sh <env> <branch, tag or commit>
```

It mirrors the repository, builds that exact commit as the site user, takes a
database backup (`studio-mongo-backup`; a failed backup stops the release),
runs the database migration, switches `current` atomically, restarts the
service and waits for `/api/health?ready=1`. If the new release is not healthy
within 60 s it switches back to the previous one. The last 5 releases stay on
disk.

## Rolling back

Instant (no rebuild): point `current` at an older release and restart.

```sh
ls -1t /home/<user>/app/releases/          # newest first
sudo ln -sfn /home/<user>/app/releases/<sha> /home/<user>/app/current
sudo systemctl restart studio-companion-<env>
```

Or release an older commit or tag with `release.sh`. Migrations are additive,
so older releases run against the newer schema.

**The plan catalog (ADR-0014).** From the release that added rollback safety
on, an older release keeps what a newer one published that it does not know
(feature IDs, sections) and applies none of it. It never replaces an
unreadable catalog with the defaults: `plans` stays exactly as it is.

- **Never roll back below that release** once a later release has published
  a new feature ID or catalog section. Releases before it reset every plan
  to the code defaults on such a catalog.
  - The first new feature IDs are `export.pdf` (grid PDFs, M2, ADR-0015)
    and `export.worksheets` (M3, ADR-0016). Both shipped unpublished. From
    the first published catalog that includes either, the floor is
    `224bb65`.
  - M4 (ADR-0017) adds `learn.curriculum`, `learn.color`,
    `learn.challenges` and the catalog section `learn`; the same floor
    applies. A release before M4 has no Learn routes: rolling back closes
    Learn, and its content and files stay untouched.
- **After any rollback, check the catalog** with the release now live (read
  only):

  ```sh
  npm run db -- catalog-status   # as the site user, see "Operating" below
  ```

  It must say `ok` (or `partial`, if features are withheld on purpose) and
  `in step` for both plans. `unreadable` means the release cannot read the
  published catalog: `plans` was left as it was, and Admin → Plans is
  read-only. Go forward again, or restore an earlier version from Admin →
  Plans.
- **After an instant rollback** (no migration), `plans` still holds what the
  newer release wrote. The older release ignores what it does not know, and
  the next migration brings `plans` back in step.

## Operating

- Logs: `journalctl -u studio-companion-<env> -f` (JSON lines from the app).
- Health: `curl -s http://127.0.0.1:<port>/api/health?ready=1`.
- Accounts from the command line (as the site user, with its Node.js and the
  environment loaded):

  ```sh
  . /etc/studio-companion/<env>.conf
  cd "$APP_DIR/current" && sudo -u "$APP_USER" env PATH="$NODE_BIN:/usr/bin:/bin" \
    bash -c 'set -a; . /etc/studio-companion/<env>.env; set +a; npm run db -- <command>'
  ```

  - `list-users`: every account with emails masked, its Google link, role,
    plan and whether it is on the invite list;
  - `grant-admin <userId>`: the first admin (later admins can be made from
    `/admin`); refused unless the account is active, Google-verified and
    linked to exactly one Google identity;
  - `revoke-admin <userId>`: never removes the last admin;
  - `set-plan <userId> free|pro`: assign a plan for testing (no billing).

  All of them are recorded in the audit log (`/admin/activity`).

### Learn content and its assets (ADR-0017)

- **Once per environment, as root, before the first release with Learn:**

  ```sh
  sudo deploy/install-learn-assets.sh <env>
  ```

  It creates `/var/lib/studio-companion/<env>/learn-assets` (the site's
  user, 0750; outside every release and `public/`) and the backup copy
  `/var/backups/learn-assets/<env>` (root, 0700). It adds `LEARN_ASSETS_DIR`
  to the env file (the previous one is kept in `/root/backups/`), and
  installs `studio-learn-assets-backup` with its cron job (02:50, after the
  database dump). It is idempotent. The next release or restart applies
  the setting.
- **Content, as the site user** (see "Operating"):
  - `learn-import <folder>`: stores the folder's assets (checked by their
    bytes; licence required) and saves its content as a draft, never over
    a draft. The folder is kept outside the repository.
  - `learn-status`: read only. The live and draft content, every asset's
    file checked against its hash, the licences, and what each plan opens.
    Exit code 1 on any problem.
  - `learn-publish`: prints what the draft changes, then publishes it;
    audited.
  - `learn-discard`: discards the draft.
  - Admin → Learn shows the same, and publishes, discards and restores
    versions. Who sees what is set in Admin → Plans.
- **Backups:**
  - the content and asset metadata are in MongoDB, so in every dump;
  - the files are in the nightly incremental copy;
  - the restore drill restores both:
    `studio-restore-drill <dump> --manifest <manifest> --assets /var/backups/learn-assets/<env>`
    (docs/ops/backups.md).

## Server notes

- **nginx log rotation:** CloudPanel's per-site rotation rules reload nginx
  with a command that does not reliably complete, so nginx kept writing into
  the rotated files. Fixed by the systemd drop-in
  `/etc/systemd/system/logrotate.service.d/reopen-nginx-logs.conf`, which sends
  nginx SIGUSR1 (reopen logs) after every rotation run. CloudPanel's own files
  are untouched; remove the drop-in and `systemctl daemon-reload` to undo.
  Backup of the previous configuration: `/root/backups/logrotate-<timestamp>/`.
- **Nightly MongoDB dump** (`/etc/cron.d/studio-mongo-backup` →
  `/usr/local/sbin/studio-mongo-backup`, 02:40 server time, 14 days in
  `/var/backups/mongodb`). cron ignores files in `/etc/cron.d` that are group-
  or world-writable: the file must stay `root:root 0644`. Until 2026-11-10 it
  was `0664` and the job never ran (cron logged `INSECURE MODE`); check with
  `journalctl -u cron | grep studio-mongo` and `ls -lt /var/backups/mongodb`.
- **Nightly maintenance** (staging since 2026-11-11): `/etc/cron.d/studio-maintenance`
  (03:20, `root:root 0644`) runs `/usr/local/sbin/studio-maintenance staging`
  (`deploy/maintenance.sh`).
- **Phase 1 configuration change (2026-11-10):** staging's env file gained
  `APP_ENV`, `AUTH_EMAIL_PASSWORD` and `MAIL_TRANSPORT`; the previous file and
  release script are in `/root/backups/phase1-20261110T233138Z/`.
- **Off-site backups:** see `deploy/offsite-backups-plan.md` (plan, not yet
  implemented).

## Smoke test after a release

`deploy/smoke.sh <base-url> <commit>` checks over HTTPS, read-only, from any
machine:

- `/api/health` reports the expected commit;
- the public pages answer in English, and in Hebrew right to left;
- signed-out visitors are sent to sign-in from `/app` and `/admin`;
- there is exactly one Content-Security-Policy, with a fresh nonce on every
  request;
- the auth API answers;
- oversized request bodies are refused (413).

It never signs in. Signing in as the owner, and as a returning user, is
checked separately, by person and in the database records.
