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

## Releasing

```sh
sudo deploy/release.sh <env> <branch, tag or commit>
```

It mirrors the repository, builds that exact commit as the site user, runs the
database migration, switches `current` atomically, restarts the service and
waits for `/api/health?ready=1`. If the new release is not healthy within 60 s
it switches back to the previous one. The last 5 releases stay on disk.

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
- Admin access: `cd /home/<user>/app/current && sudo -u <user> bash -c 'set -a; . /etc/studio-companion/<env>.env; set +a; npm run db -- find-user <email>'`,
  then `… npm run db -- grant-admin <userId>`.
