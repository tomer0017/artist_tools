# Incident response plan

**Written:** 2026-11-11. **Status:** draft; to be agreed with the owner.
The notification duties described here must be confirmed by counsel (the
Privacy Protection (Data Security) Regulations, 2017, and others).

## Who

| Role | Who | Reachable at |
|---|---|---|
| Incident lead and decision-maker | [owner] | [phone, email] |
| Technical response | [owner / engineer] | [ ] |
| Legal and privacy advice | [lawyer] | [ ] |

## What counts as an incident

- An account taken over, or unexpected admin activity (check the audit log).
- Personal data exposed, or possibly exposed.
- The server compromised, or credentials leaked (SSH keys, OAuth secret,
  database, provider keys).
- The service down, or data lost or corrupted.
- Once billing is live, wrong charges or wrong plan access.

## Steps

1. **Contain.**
   - Revoke what is affected: suspend the account (which signs it out
     everywhere), or sign out every session from the server.
   - Rotate secrets: the Google OAuth secret, `BETTER_AUTH_SECRET` (this
     signs everyone out), and provider keys.
   - Block at nginx if needed.
   - Do not wipe evidence.
2. **Preserve evidence.** Copy the logs and the audit log, and take a
   database dump, before changing data.
   - Logs: `journalctl -u studio-companion-<env>`, nginx logs and
     `/var/log/auth.log`.
   - The audit log: `/admin/activity` export, or a database query.
3. **Assess.**
   - What happened, when, and to which accounts and data.
   - Whether personal data was affected, and whose.
   - Whether it is still happening.
4. **Recover.**
   - Fix the cause.
   - If data was lost or corrupted, restore from a backup: the release
     directory keeps the previous builds, and backups are under
     `/var/backups/mongodb`.
   - Verify the service through `/api/health` and the smoke tests.
5. **Notify.**
   - Decide with counsel about notifying the Privacy Protection Authority
     and the affected people, and how quickly, under the applicable
     regulations.
   - Tell the affected users plainly: what happened, what it means for them,
     and what to do.
6. **Learn.** Write a short report: timeline, cause, impact, and what
   changes. Add tests or monitoring so it is caught earlier next time.

## Prepared in advance

- Recent backups, and a restore drill that has been run (**not yet** —
  `docs/launch/checklist.md`).
- A list of every secret and where it is rotated (`deploy/README.md`).
- Monitoring that alerts someone (**not yet**).
