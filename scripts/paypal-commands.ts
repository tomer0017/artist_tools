// PayPal commands for operators (docs/billing/03-paypal.md), run with the
// environment configured (.env.local locally; the server's env file there):
//
//   npm run db -- paypal-check       read-only: the app's PayPal permissions, its plans, the webhook, the rate
//   npm run db -- paypal-setup       create the PayPal product and plans if missing and register the webhook
//                                    (https servers only); prints PAYPAL_WEBHOOK_ID=… for the environment file
//   npm run db -- billing-reconcile  hourly by cron: re-read every subscription that can still change from
//                                    PayPal, close stale checkouts, refresh the Bank of Israel rate
//
// Nothing secret is printed: no credentials, tokens, payer names or emails.
import type { Db } from 'mongodb';
import { formatRate, rateForQuote, refreshRates, usdToIls } from '@/server/billing/fx';
import { createPayPalClient } from '@/server/billing/paypal/client';
import { basePrice, ensurePlan, ensureWebhook, reconcilePayPal } from '@/server/billing/paypal/subscriptions';
import { collections } from '@/server/db/collections';
import { authConfig, paypalConfig } from '@/server/env';

const SUBSCRIPTIONS_SCOPE = 'https://uri.paypal.com/services/subscriptions';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function settingsOrExplain() {
  const settings = paypalConfig();
  if (!settings) console.log('PayPal is not set up here: PAYPAL_ENV, PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set (bash deploy/set-paypal.sh).');
  return settings;
}

export async function paypalCheck(db: Db): Promise<number> {
  const settings = settingsOrExplain();
  if (!settings) return 1;
  const client = createPayPalClient(settings);
  let failed = 0;
  const line = (ok: boolean, text: string) => {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${text}`);
  };
  console.log(`PayPal ${settings.environment} (${settings.apiBase})`);
  try {
    const scopes = await client.scopes();
    line(scopes.includes(SUBSCRIPTIONS_SCOPE), `credentials accepted; the app ${scopes.includes(SUBSCRIPTIONS_SCOPE) ? 'may' : 'may NOT'} use Subscriptions`);
  } catch (error) {
    line(false, `credentials refused or PayPal unreachable: ${message(error)}`);
    return 1;
  }
  const plans = await collections(db).billingPlans.find({ environment: settings.environment }).toArray();
  if (plans.length === 0) console.log('  --    no PayPal plans yet (npm run db -- paypal-setup, or the first checkout, creates them)');
  for (const plan of plans) {
    try {
      const remote = await client.request<{ status?: string }>('GET', `/v1/billing/plans/${encodeURIComponent(plan.planId)}`);
      line(remote.status === 'ACTIVE', `${plan.currency} plan ${plan.planId}: ${remote.status ?? 'unknown'}`);
    } catch (error) {
      line(false, `${plan.currency} plan ${plan.planId}: ${message(error)}`);
    }
  }
  try {
    const hooks = (await client.request<{ webhooks?: { id: string; url: string }[] }>('GET', '/v1/notifications/webhooks')).webhooks ?? [];
    const ours = hooks.find((h) => h.id === settings.webhookId);
    if (!settings.webhookId) line(false, `PAYPAL_WEBHOOK_ID is not set (${hooks.length} webhook(s) registered for this app)`);
    else line(Boolean(ours), ours ? `webhook ${ours.id} → ${ours.url}` : `PAYPAL_WEBHOOK_ID is not one of this app's webhooks`);
  } catch (error) {
    line(false, `webhooks could not be listed: ${message(error)}`);
  }
  try {
    const rate = await refreshRates(db);
    line(true, `Bank of Israel USD/ILS ${formatRate(rate.rateMicros)} published ${rate.date}`);
  } catch (error) {
    line(false, `Bank of Israel rate: ${message(error)}`);
  }
  return failed ? 1 : 0;
}

export async function paypalSetup(db: Db): Promise<number> {
  const settings = settingsOrExplain();
  if (!settings) return 1;
  const client = createPayPalClient(settings);
  const scopes = await client.scopes();
  if (!scopes.includes(SUBSCRIPTIONS_SCOPE)) console.log('Warning: PayPal does not list Subscriptions among this app\'s permissions.');
  // The plans need a price; without one they are created by the first checkout instead.
  const base = await basePrice(db);
  if (!base) console.log('No published monthly Pro price yet: the PayPal plans are created on the first checkout after it is published.');
  else {
    console.log(`USD plan ${await ensurePlan(db, client, 'USD', base.amountMinor)}`);
    const rate = await rateForQuote(db);
    if (rate) console.log(`ILS plan ${await ensurePlan(db, client, 'ILS', usdToIls(base.amountMinor, rate.rateMicros))}`);
    else console.log('ILS plan not created yet: the Bank of Israel rate could not be confirmed (the first ILS checkout creates it).');
  }
  const { baseURL } = authConfig();
  if (!baseURL.startsWith('https://')) {
    console.log(`No webhook: PayPal only notifies https addresses (this server is ${new URL(baseURL).origin}). Subscriptions are still read from PayPal on return and by billing-reconcile.`);
    return 0;
  }
  const hook = await ensureWebhook(client, `${new URL(baseURL).origin}/api/billing/paypal/webhook`);
  console.log(`Webhook ${hook.created ? 'registered' : 'already registered, events updated'}.`);
  // The last line is read by studio-set-paypal to store it in the environment file.
  console.log(`PAYPAL_WEBHOOK_ID=${hook.id}`);
  return 0;
}

export async function billingReconcile(db: Db): Promise<number> {
  const settings = paypalConfig();
  if (!settings) {
    // Without PayPal there is nothing to reconcile, but the shekel rate is still kept current.
    await refreshRates(db).catch(() => undefined);
    return 0;
  }
  const run = await reconcilePayPal(db, createPayPalClient(settings), 'cron');
  console.log(`Billing reconciled (${settings.environment}): ${run.checked} checked, ${run.fixed.length} corrected, ${run.missing.length} not found at PayPal.`);
  return 0;
}
