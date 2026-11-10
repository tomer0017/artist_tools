# Off-site MongoDB backups — implementation plan

> **Status: plan only.** Nothing here is implemented yet; no account, bucket,
> key or credential exists. Each step marked *(you)* needs the owner; each step
> marked *(server)* needs explicit approval before it is applied.

## Today

- Nightly at 02:40 (Europe/Berlin), `/usr/local/sbin/studio-mongo-backup`
  writes a gzipped `mongodump` archive of all databases to `/var/backups/mongodb`
  on the VPS itself and keeps 14 days.
- If the VPS is lost, compromised or deleted, every backup goes with it.

## Goals

1. Survive the loss of the VPS (failure, provider incident, accidental deletion).
2. A compromised VPS can create new backups but can **not** read, overwrite
   or delete existing ones.
3. Retention and deletion are enforced by the **storage provider**, not by any
   credential on the VPS.
4. A missed or failed backup is noticed within a day.
5. Restores are proven regularly with a real restore, not just a file listing.
6. Data stays in the EU and is encrypted before it leaves the server.

## Design

| Concern | Choice |
|---|---|
| Storage | **Backblaze B2, EU Central** region (S3-compatible). Chosen for per-key capability restrictions (upload without delete or read), bucket-level Object Lock and lifecycle rules. Alternatives to evaluate if preferred: Scaleway Object Storage (FR) or Hetzner Object Storage (DE/FI) — confirm Object Lock and key scoping before choosing. |
| Encryption | **age** (asymmetric). The VPS holds only the *public* recipient key, so it can encrypt but never decrypt. The private identity lives only in the owner's password manager plus one offline copy. |
| Upload | `rclone` (already installed) with a B2 remote in a root-only config (`/root/.config/rclone/rclone.conf`, mode 600). |
| VPS credential | A B2 application key restricted to the single bucket with only `listBuckets`, `listFiles`, `writeFiles`. **No** `readFiles`, `deleteFiles`, `bypassGovernance` or retention-changing capabilities. |
| Immutability | Bucket created with **Object Lock**, default retention **30 days** (governance mode). Even a key with delete rights could not remove a locked backup; the VPS key has none. |
| Deletion | A bucket **lifecycle rule** removes objects 35 days after upload (after their lock expires). Deletion is entirely the provider's job. |
| Long-term copy | Optional second prefix `monthly/` (first backup of each month), lock 90 days, lifecycle 365 days. |
| Monitoring | **healthchecks.io** check per job: the script pings `/start`, then success or `/fail` with the exit code. Email alert if a run fails or does not report within schedule + 1 h grace. No backup content is sent, only status. |
| Restore drills | Monthly, on the owner's Mac (or a throwaway machine), with a separate **read-only** B2 key that never touches the VPS. A second healthchecks.io check (period 35 days) alerts if a drill is missed. |

### What each party can do

| | Upload new backup | List | Download / read | Overwrite / delete | Decrypt |
|---|---|---|---|---|---|
| VPS (backup key) | yes | yes | no | no (key + Object Lock) | no (public key only) |
| Owner's restore key (off-server, created for drills) | no | yes | yes | no | with the private identity |
| B2 account owner (web console, MFA) | — | yes | yes | only after the lock expires | with the private identity |

## Nightly job (after implementation)

1. `mongodump --archive --gzip` → `mongodb-<UTC timestamp>.archive.gz` (as today).
2. `mongorestore --dryRun` against the local archive to confirm it is readable.
3. Manifest `mongodb-<ts>.manifest.json`: database and collection document
   counts, archive size and SHA-256 (no data).
4. `age -r <recipient>` → `mongodb-<ts>.archive.gz.age` (+ manifest, also encrypted).
5. `rclone copy` both files to `b2:studio-companion-backups-eu/daily/`, then
   `rclone check --one-way` (size and hash) to confirm the upload.
6. Ping healthchecks.io: success, or `/fail` with the step that failed.
7. Local copies: keep 14 days as today (they speed up everyday restores).

A failure at any step leaves the local backup in place, exits non-zero and
alerts; the next night retries.

## Restore drill (real restore, monthly and before production cutover)

On the owner's Mac (script to add: `deploy/restore-drill.sh`):

1. Download the newest `*.age` and its manifest with the read-only key.
2. Decrypt with the private age identity.
3. Start a throwaway MongoDB 8.0 (Docker `mongo:8.0`, or the test tooling's
   in-memory server).
4. `mongorestore --archive --gzip` with
   `--nsFrom 'studio_companion_staging.*' --nsTo 'restore_check.*'`.
5. Compare every collection's document count with the manifest; spot-check that
   the `users` / `accounts` unique indexes restored.
6. Record date, backup name, counts, duration and result; ping the drill check.
7. Destroy the throwaway database and the decrypted file.

Once a year, or before production: a full rehearsal on a fresh VPS (install
MongoDB, restore, release the app, smoke test).

## Implementation steps

1. *(you)* Create the Backblaze account in the **EU Central** region (the region
   is chosen when the account is created). Enable MFA.
2. *(you)* Create the private bucket `studio-companion-backups-eu` **with Object
   Lock enabled** (only possible at creation), default retention 30 days
   (governance), and the lifecycle rules above.
3. *(you)* Create the restricted application key for the VPS (capabilities
   above, this bucket only). Do not create the read-only key yet.
4. *(you)* Create the healthchecks.io checks (`mongo-backup`, daily 02:40
   Europe/Berlin, grace 1 h; `restore-drill`, period 35 days).
5. *(you)* On the Mac: `age-keygen -o studio-backup-identity.txt`. Store the file
   in the password manager plus one offline copy, then delete it from disk.
   **Without it, no backup can ever be restored.** Send me only the public line
   (`age1…`); it is not secret.
6. *(server)* Install `age` (`apt install age`); add a stdin-based installer
   (same pattern as `deploy/install-google-oauth.sh`) for the B2 key and the
   healthchecks URL; configure the rclone remote, root-only.
7. *(server)* Extend `studio-mongo-backup` as above. Back up the current script
   first.
8. *(server)* Verify: run once; confirm the object exists with its retention
   lock; prove the VPS key **cannot** download or delete it (both must fail);
   confirm the healthchecks.io ping.
9. *(you + me)* First real restore drill with a temporary read-only key, then
   disable that key.

**Rollback:** remove the rclone remote and restore the previous backup script.
Nothing already uploaded can be removed early (by design); it expires through
the lifecycle rules.

## Notes

- **Cost:** negligible at today's data size (megabytes). Check current B2
  pricing before creating anything.
- **Personal data:** backups contain account data (emails, names). EU region,
  encryption before upload, and the provider's data processing agreement cover
  this; record it in the privacy documentation.
- **Production:** if production moves to MongoDB Atlas, Atlas's managed
  backups cover production data; this plan then remains for staging (or is
  dropped).
