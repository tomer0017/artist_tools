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

### Opening public registration (only when approved)

Staging stays invite-only. To let anyone with a Google-verified address create
a free account, add `AUTH_SIGNUP_MODE="open"` to `/etc/studio-companion/<env>.env`
(back up the file first) and `systemctl restart studio-companion-<env>`, then
check `/api/health?ready=1`. New accounts are always role `user` on Free;
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
- **Off-site backups:** see `deploy/offsite-backups-plan.md` (plan, not yet
  implemented).
