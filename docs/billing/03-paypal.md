# PayPal subscriptions — how it works and how to run it

**Written:** 2026-11-23. **State:** built and tested locally (fake PayPal in the
tests). Not yet run against PayPal's sandbox or live, not deployed.
Decisions: [ADR-0022](../adr/0022-paypal-subscriptions.md).

## What a customer gets

- **Price.** One monthly Pro price, set in USD by the owner in Admin → Pricing.
  - A customer pays in their Profile currency.
  - In USD, they pay the price as set.
  - In ILS, they pay the USD price converted at the Bank of Israel's latest representative rate, rounded to the agora.
    The rate must have been confirmed within the last hour.
- **Checkout** (`/subscribe`) shows the exact amount, the currency, and "every month until you stop it".
  For ILS it also shows the rate and its date, plus how stopping and refunds work.
  The customer then ticks an unticked consent box and goes to PayPal, in the same window.
- **The price is theirs for good.** Each PayPal subscription carries the agreed price (PayPal's plan override),
  so a new price or a new rate never changes an existing subscription.
  There is one PayPal plan per currency, and nothing else in PayPal needs managing.
- **Pro starts only when PayPal reports a completed payment.**
  The server reads it from PayPal itself: on the return page, from a verified webhook, or in the hourly reconciliation.
  Coming back from PayPal grants nothing by itself.
- **Stop automatic renewal** (account page) cancels at PayPal at once, so no further charge is taken.
  Pro stays until the paid-through date.
  A cancellation made inside PayPal works the same way.
- **Request cancellation and refund** (account page) stops renewal at once and records a request for the owner.
  The suggested refund is:
  - in full within 7 days of the first payment, once per account;
  - after that, the unused part of the period.

  Statutory rights are not limited by this. Nothing is refunded automatically.
- **Failed renewal.** PayPal retries after 5 and 10 days. Pro continues for a grace week (`GRACE_DAYS`).
  If PayPal suspends the subscription after its retries, Pro ends once the grace week is over.
- **Manual Pro and the admin role** are separate sources of access. Billing never changes them, and they never change billing.

## Safety rules built in

- Live credentials are refused unless `APP_ENV=production`, both by the app (`src/server/env.ts`) and by the server installer.
  Staging and local machines can only use the sandbox.
- The Client Secret lives only in the environment file. It never reaches the browser, the repository, the logs or the chat.
  The access token is kept in memory and never logged.
- **Webhooks.**
  - PayPal itself confirms each webhook's signature for our webhook ID, using the raw body.
  - Each event is stored once, and an event whose processing failed is processed again when PayPal redelivers it.
  - The subscription or payment an event names is then read again from PayPal.
- **Only subscriptions this server created count.**
  Unknown ones grant nothing and are logged.
  A second subscription for the same account, or a charge for a different amount than agreed, is cancelled at PayPal and flagged.
- **Refunds and chargebacks.** A full refund or a chargeback ends the paid time it returned, and stops renewal.
- **Who can subscribe and who changes prices.**
  - Until the owner opens subscriptions to everyone (Admin → Billing), only administrators and the listed testers can subscribe.
  - Only the owner can change prices, who may subscribe, and refund decisions.

## Setting it up

### 1. PayPal Developer (you)
1. Open <https://developer.paypal.com/dashboard/applications>.
2. Switch to **Sandbox** and create or open the app.
3. In *Sandbox → Accounts*, have a **Business** account (Israel, if offered) and two **Personal** buyer accounts (Israel, US).
4. Later, switch to **Live** for the live app. Its credentials go to production only.

### 2. Credentials (you type them; nobody else sees them)
```
cd "/Users/tomercohen/Documents/אתרים/Art Studio Companion"
bash deploy/set-paypal.sh sandbox local        # this Mac, for local tests
bash deploy/set-paypal.sh sandbox staging      # staging (after the server step below)
bash deploy/set-paypal.sh live production      # production, after approval
```
On a server, the installer does four things:
1. writes the credentials into the root-only environment file, saving the previous file as `.previous`;
2. creates the PayPal product and plans;
3. registers the webhook `https://<site>/api/billing/paypal/webhook`;
4. stores its ID as `PAYPAL_WEBHOOK_ID`.

The app picks them up at its next restart.

### 3. Server (with approval)
```
install -m 755 deploy/install-paypal.sh /usr/local/sbin/studio-set-paypal
install -m 755 deploy/billing-reconcile.sh /usr/local/sbin/studio-billing-reconcile
echo '7 * * * * root /usr/local/sbin/studio-billing-reconcile <env>' > /etc/cron.d/studio-billing-reconcile-<env>
chmod 0644 /etc/cron.d/studio-billing-reconcile-<env>
```
Check with `npm run db -- paypal-check`. It is read-only and shows:
- whether the app's permissions include Subscriptions;
- the plans' status;
- the webhook;
- the Bank of Israel rate.

### 4. Opening it
1. Publish the monthly price in Admin → Pricing.
2. List testers in Admin → Billing.
3. Switch on "Open to everyone" only after the live test has passed.

## Running it

- **Refunds.**
  - The request appears in Admin → Billing with the suggested amount.
  - Refund it in PayPal (Activity → the payment → Refund).
  - PayPal reports the refund back: it is recorded, the paid time it returned ends, and the request closes by itself.
  - Decline a request, or close one by hand, in Admin → Billing.
- **Disputes and chargebacks.** These are answered in PayPal (Resolution Center). They show as flagged events here.
- **Never edit the plans' prices in PayPal's dashboard.** Each subscription holds its own price, so an edit would only confuse.
  To change the price, use Admin → Pricing.
- **If PayPal or the Bank of Israel is down.**
  - Checkout says so and charges nothing.
  - Existing subscribers keep Pro: access ends only by time.
  - The hourly reconciliation catches up afterwards.
  - ILS checkout pauses while the rate cannot be confirmed; USD is unaffected.
- **Check now.** Admin → Billing → "Check with PayPal now" runs the reconciliation immediately.

## Not done yet (before real payments)
These are listed with their order in the owner's plan:
- a production environment with its own domain, database, backups (including off-site) and mail;
- the sandbox end-to-end run, including on an iPhone;
- the legal pages and texts;
- receipts for every payment;
- VAT decisions;
- the controlled live test.
