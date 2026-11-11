# Monitoring: errors and uptime

**Written:** 2026-11-11. Lightweight, first-party, and free. Nothing is sent
to a third-party monitoring service, and nothing personal is collected.

## Error monitoring (built in)

| Part | Where |
|---|---|
| **The browser:** errors and unhandled promise rejections are sent to our own server: the message, stack, page path and release. At most 5 per page load. Errors from browser extensions and "Script error." are ignored. | `src/components/common/ErrorReporter.tsx`, in the root layout |
| **The endpoint:** `POST /api/client-errors`. Accepts only this site's pages, bodies up to 10 KB, and 30 reports per IP per 10 minutes. The throttle stores a hash of the IP, which expires; the IP itself is not kept. | `src/app/api/client-errors/route.ts` |
| **The server:** errors while rendering pages or answering routes and actions (Next.js `onRequestError`). Only the route pattern is kept, such as `/admin/users/[id]`. | `src/instrumentation.ts` |
| **Storage:** grouped by a fingerprint (message with numbers folded, plus the top stack line), with a count, first and last seen, and up to 10 page paths, releases and browsers ("Safari on iPhone") | `src/server/error-reports.ts`, collection `error_reports` |
| **The admin view** | `/admin/errors` |

**What is never stored:**

- account ids, IP addresses, full user agents;
- query strings and fragments, request bodies, cookies;
- email addresses (replaced by `[email]`);
- token-like strings of 32 or more characters (replaced by `[token]`).

**Retention:** a group not seen for 30 days removes itself (TTL index on
`lastSeen`). The server log (`journalctl -u studio-companion-<env>`) still
has the full server-side errors, as before.

## Uptime monitoring

**Ready in the repository:** `.github/workflows/uptime.yml` checks
`GET /api/health?ready=1` every 30 minutes, which also checks the
configuration and the database. It tries three times, 20 seconds apart. If
the app is still unhealthy, the run fails, and GitHub emails the account
that last changed the schedule. It costs nothing and needs no account
beyond GitHub.

**Owner decision needed to switch it on.** GitHub runs scheduled workflows
only from the repository's **default branch** (`main`), and `main` also
serves the GitHub Pages production site. Choose one:

1. **Merge the workflow file alone into `main`** (`.github/workflows/uptime.yml`
   only). This does not change the Pages site's files, but it is a commit on
   the production branch, so it needs your approval.
2. **Use an external free monitor instead**, such as UptimeRobot or
   healthchecks.io (an account in your name). Point it at
   `https://<host>/api/health?ready=1` and expect `"status":"ok"`.
3. **Run it by hand** when wanted: GitHub → Actions → Uptime → Run workflow.
   This works from any branch.

To monitor another address later (production), set the repository variable
`UPTIME_URL` (Settings → Secrets and variables → Actions → Variables). It
is not a secret.

## Not monitored yet

- Server resources (disk, memory) and certificate expiry.
- Whether the nightly backup ran. Today the release log and `ls -lt
  /var/backups/mongodb` show it. The off-site backup script reports its own
  result (`docs/ops/backups.md`).
