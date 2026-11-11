# Backups and restore drills

**Written:** 2026-11-11. The design is in `deploy/offsite-backups-plan.md`.
This page is what is built, what has been verified, and the owner's
remaining steps.

## Status

| Part | State |
|---|---|
| Nightly local dump (02:40 server time, 14 days kept) | **Running.** The first scheduled run was verified on 2026-11-11. |
| Dump before every release migration | **Running** (`deploy/release.sh`) |
| Checking that a dump is readable, plus a manifest with sizes, SHA-256 and live document counts (no data) | **Built and verified on staging**: `deploy/backup-offsite.sh --check-only` |
| Restore drill (a real restore into a throwaway database, compared with the manifest, unique indexes checked, then dropped) | **Built and run on staging on 2026-11-11** (`deploy/restore-drill.sh`): restored in 4 s, counts matched, nothing left behind |
| Encrypted off-site copy | **Built, waiting for the owner's accounts.** Encryption with `age` (the server holds only the public key), upload with `rclone`, and a hash check of the upload |
| Alert when a backup fails or does not run | **Waiting for the owner's account** (healthchecks.io; the script pings it when configured) |

### Found by the first restore drill

Better Auth's MongoDB adapter creates **no indexes**. The code had assumed
it did. So `users.email` was not unique, and session tokens were looked up
without an index. The unique and lookup indexes are now part of the
migration (`src/server/db/migrate.ts`). A duplicate email would stop the
migration, and with it the release, before the switch.

## Owner's setup for off-site copies

Each step is done once. Nothing here can be done without your accounts and
keys, and the keys never go through the chat.

1. **Encryption key, on your Mac** (`brew install age`):

   ```
   age-keygen -o studio-backups-key.txt
   ```

   - The **public** key is printed (`age1…`); it goes on the server.
   - Keep `studio-backups-key.txt` (the **private** key) in your password
     manager, plus one offline copy. Without it, no backup can be restored.
     It never goes on the server.
2. **Storage: Backblaze B2**, region EU Central. Create a bucket
   `studio-companion-backups-eu` with:
   - **Object Lock** on, default retention 30 days (governance);
   - a **lifecycle rule** that deletes files 35 days after upload.

   Then create two application keys:

   | Key | Scope | Capabilities |
   |---|---|---|
   | Server key | This bucket only | listBuckets, listFiles, writeFiles. **Not** readFiles or deleteFiles. |
   | Restore key, for your Mac only | This bucket only | listFiles, readFiles |

3. **Alerts:** a free healthchecks.io account. Create a check "Studio
   backups" with a period of 1 day and a grace of 1 hour. Copy its ping URL.
4. **On the server, as root** (I can do these with your approval once the
   keys exist; you would type the secret parts yourself):

   ```
   apt install age
   rclone config create b2-backups b2 account <server key id> key <server key>
   install -m 600 /dev/null /etc/studio-companion/offsite.conf
   cat >> /etc/studio-companion/offsite.conf <<'CONF'
   RCLONE_REMOTE=b2-backups:studio-companion-backups-eu/daily
   AGE_RECIPIENT=age1...your public key...
   HEALTHCHECK_URL=https://hc-ping.com/...your check...
   CONF
   install -m 755 deploy/backup-offsite.sh /usr/local/sbin/studio-offsite-backup
   install -m 755 deploy/restore-drill.sh /usr/local/sbin/studio-restore-drill
   install -m 644 deploy/cron/studio-offsite-backup /etc/cron.d/
   /usr/local/sbin/studio-offsite-backup     # a first run now; check the log and the bucket
   ```

## Restore drill

**On the server, the latest local dump (no keys needed):**

```
newest=$(ls -1t /var/backups/mongodb/mongodb-*.archive.gz | head -1)
/usr/local/sbin/studio-offsite-backup --check-only        # writes the manifest
studio-restore-drill "$newest" --db studio_companion_staging --manifest "${newest%.archive.gz}.manifest.json"
```

**Monthly, from the off-site copy, on your Mac:**

1. Install the tools: `brew install age rclone mongodb-database-tools mongosh`.
2. Download the newest `*.archive.gz.age` and its `*.manifest.json.age`
   with the read-only restore key.
3. Start a throwaway MongoDB, for example a free local `mongod`.
4. Run:

   ```
   MONGO_URI=mongodb://localhost:27017 deploy/restore-drill.sh <file>.archive.gz.age \
     --identity studio-backups-key.txt --manifest <file>.manifest.json.age
   ```

The drill:

- never touches the live database;
- drops its throwaway database afterwards;
- exits non-zero if a collection is missing or a stable collection's count
  differs.

Collections that change on their own (sessions, rate limits, events) are
reported but tolerated.

## Restoring for real (after data loss)

1. Stop the app: `systemctl stop studio-companion-<env>`.
2. Take a dump of the current state first, even if it is damaged.
3. Restore with `mongorestore --archive=<dump> --gzip --drop`, using the
   admin credentials (the comment in `/usr/local/sbin/studio-mongo-backup`).
   Restore one database with `--nsInclude='studio_companion_<env>.*'`.
4. Run the migration (`npm run db -- migrate` in the current release), start
   the app, and run `deploy/smoke.sh`.
