# 0006 — Admin configuration as versioned drafts and publications

**Status:** Accepted (2026-11-10)

## Context
The owner must be able to change features per plan, quotas, prices, trials and
coupons without a deploy, but a wrong change can lock users out or misprice
the product. Today the plan matrix lives in code and the migration copies it
into `plans`.

## Decision
- Configuration lives in `config_versions`, one series per kind (`catalog`,
  `pricing`). Admins edit a draft, see it validated (zod) and diffed against the
  published version, and publish it; exactly one version per kind is
  published. Rollback is publishing an older version.
- Code holds the defaults and the feature ids (features are code: a new feature
  needs code that checks it). The first migration publishes today's matrix as
  version 1, so nothing changes until an admin publishes.
- Entitlements read the published catalog (cached briefly, invalidated on
  publish). Admins always keep every feature.
- Publishing requires a fresh admin session and is audited with the version
  numbers.

## Consequences
- Every configuration state that ever applied can be reconstructed.
- The code-owned `plans` sync is replaced by the published catalog; until
  Phase 2 ships, code remains the source of truth.

## Alternatives considered
- Editing `plans` in place: no history, no review step, no rollback.
- Configuration in env files: needs server access and a restart.
