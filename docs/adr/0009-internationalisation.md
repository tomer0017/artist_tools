# 0009 — Internationalisation and RTL strategy

**Status:** Proposed — library compatibility is verified at the start of Phase 3

## Context
English and Hebrew first (Hebrew is RTL), Spanish and French later. The studio
is a client-rendered app whose tools draw on canvases with pointer gestures;
public pages need SEO.

## Decision
- Library: `next-intl` if its current release supports the installed Next.js
  16 App Router (checked against its release notes and our build before
  adoption); otherwise the closest maintained alternative, recorded here.
- Messages: one ICU dictionary per locale in the repo (`messages/en.json`,
  `messages/he.json`); a test requires identical keys across locales and valid
  ICU syntax.
- Locale resolution: signed-in → `users.locale`; visitors → cookie, then
  `Accept-Language`, then English. Public marketing pages are also served under
  a locale prefix (`/he/…`) with `hreflang` alternates; the studio (`/app`) does
  not use prefixes, so tool URLs stay stable.
- Direction: `lang` and `dir` on `<html>`; layouts use logical CSS properties
  (`ms-`, `me-`, `start-`, `end-`, `rtl:` variants). Canvas surfaces, their
  overlays and gesture math stay `dir="ltr"`; only surrounding text and
  controls flip.
- Formatting through `Intl` (dates, numbers, currency from minor units).
- Not translated: identifiers, feature ids, user artwork, user-entered names.

## Consequences
- Tool behaviour is unchanged in Hebrew; parity screenshots run per locale.
- Every new UI string goes through the dictionary from Phase 3 on.

## Alternatives considered
- Locale prefix for every route including the studio: breaks existing tool
  URLs and adds no SEO value behind sign-in.
- Mirroring canvases in RTL: changes measurement geometry; rejected.
