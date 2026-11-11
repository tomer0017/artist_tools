# 0009 — Internationalisation and RTL strategy

**Status:** Accepted (2026-11-11) — Phase 3a and 3b-1 (studio frame) built; 3b-2 (the five tools) next

## Context
English and Hebrew first (Hebrew is RTL), Spanish and French later. The studio
is a client-rendered app whose tools draw on canvases with pointer gestures;
public pages need SEO.

## Decision
- Library: **`use-intl` 4.14.9**, the core of next-intl by the same
  maintainer. next-intl 4.14 supports Next.js 16, but we do not use its
  locale routing for the studio, and it now pulls native build tools
  (`@swc/core`, `@parcel/watcher`) for message extraction we do not need.
  Server components translate with `createTranslator` (`src/i18n/server.ts`);
  client components with `useTranslations` under `I18nProvider`. Versions are
  pinned (dependencies at least two weeks old; three fresh transitive packages
  pinned with `overrides`).
- Messages: one ICU dictionary per locale in the repo, as TypeScript
  (`src/i18n/messages/en.ts` is the source; `he.ts` must have the same type,
  so a missing key fails the build); a test also checks identical keys, valid
  ICU in each language and the same placeholders and link tags.
- Locale resolution: an explicit `/he/…` public address (the proxy rewrites
  it and sets a trusted header) → signed-in `users.locale` → the `sc_locale`
  cookie (set by the language switch) → `Accept-Language` → English. Public
  pages (landing, pricing, sign-in/up, password pages) are served under `/he`
  with `hreflang` alternates; the studio (`/app`) never uses prefixes, so tool
  URLs stay stable. New accounts take the language (and ILS for Hebrew) of the
  page they signed up from; account email follows `users.locale`.
- Phase 3a keeps the studio and admin English and left-to-right inside
  (`lang="en" dir="ltr"`) until their text is translated in 3b.
- Phase 3b-1 translates the studio's frame (Home, navigation, tool
  introductions, the plans and account pages, and the account page's server
  messages); each tool's own workspace, its guided tours and the shared save
  sheet stay English and left-to-right inside (`ToolFrame`) until 3b-2
  translates them tool by tool. The admin dashboard stays English (its own
  English messages), as an internal tool.
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
