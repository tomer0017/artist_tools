# Legal documents — drafts

> **DRAFTS — NOT LEGAL ADVICE — REQUIRE REVIEW BY A QUALIFIED ISRAELI
> LAWYER BEFORE ANY USE.**
>
> - Engineering wrote these on 2026-11-11 so that a lawyer starts from an
>   accurate description of how Studio Companion works.
> - They are not published anywhere, and must not be published, linked or
>   relied on until a lawyer has reviewed and approved them. (Tax and
>   invoicing parts also need an accountant.)
> - They do not establish compliance with any law and do not remove legal
>   risk.
> - Text in [brackets] is for the owner to fill in or decide.

## The drafts

| Document | What it covers | Depends on |
|---|---|---|
| [terms-of-service.md](terms-of-service.md) | Using the service, accounts, acceptable use, plans, liability, changes, governing law | Legal entity; jurisdiction |
| [privacy-policy.md](privacy-policy.md) | What personal data is collected, why, how long, who receives it, people's rights | `docs/privacy/data-inventory.md` (the facts) |
| [cookies.md](cookies.md) | Cookies and browser storage (strictly necessary only today) | — |
| [subscriptions-and-refunds.md](subscriptions-and-refunds.md) | Paid plans: renewal, cancellation, refunds, price changes | Payment provider, prices, refund policy (not decided) |
| [artwork-and-content.md](artwork-and-content.md) | Who owns the artwork, how images are processed (on the device), exports | — |
| [support-and-contact.md](support-and-contact.md) | How to reach support, response times, complaints | Support address, coordinator |

The draft accessibility statement is in `docs/accessibility/README.md`.

## Facts every draft relies on (verified in the code, 2026-11-11)

- **Images never leave the device.** All five tools process images in the
  browser, and exports are made on the device.
- **Accounts.** Accounts are created with Google, or with an email and a
  password (an address that must be confirmed).
- **Registration is invite-only during testing.**
- **No payments exist yet**, and no payment provider is connected.
- **Account deletion is immediate and permanent.** Backups still hold the
  data for up to 14 days.
- **Analytics are first-party.** Allow-listed events only, with no
  third-party trackers or advertising.
- **Hosting.** A VPS at Contabo; the region is to be confirmed. No email
  provider or payment provider has been chosen.

## Open decisions (owner, with the lawyer)

1. **Who the operator is.** Legal entity name, registration number, address,
   VAT status (עוסק פטור / מורשה / חברה).
2. **Governing law and courts.** Israel is the working assumption; the right
   courts and consumer rules need confirming. Also, whether non-Israeli
   customers (EU, US) need specific terms.
3. **Minimum age** for an account.
4. **The privacy contacts.** The privacy contact and, if needed, a
   representative or DPO. Registration of a database (מאגר מידע) with the
   Privacy Protection Authority, if required.
5. **Data retention.** Confirm the proposed retention periods (13 months for
   analytics, 24 months for the audit log) and the billing records period.
6. **Paid plans.** The refund policy, the cancellation terms under the
   Consumer Protection Law (distance transactions), how a price change is
   announced, and how trials end.
7. **Hebrew versions.** The Hebrew text after legal review, and which version
   prevails.
8. **Marketing email.** The wording of the consent and its records
   (Communications Law, section 30A, "spam" law).
9. **The accessibility coordinator's** details.

## How they become live (proposed)

1. A lawyer reviews and edits the drafts (English first; then the Hebrew
   translation is reviewed).
2. The owner fills in the [brackets] and approves.
3. Engineering publishes them as pages, in English and Hebrew, linked from
   the footer, sign-up and checkout.
4. Each published version gets a version number and date. Acceptance at
   sign-up and checkout is recorded per version, alongside the existing
   consent records.
