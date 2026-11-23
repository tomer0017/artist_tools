import { PayPalError, PayPalUnavailable, type PayPalClient, type RequestOptions } from '@/server/billing/paypal/client';
import { addMonth } from '@/server/billing/paypal/subscriptions';

// An in-memory PayPal for tests only (the app has no simulated provider,
// docs/adr/0008): products, plans with per-subscription prices, subscriptions
// moving through PayPal's statuses, their transactions, and webhooks. Tests
// drive what the buyer and PayPal do (approve, renew, fail, cancel) and can
// make the next call fail or time out.

interface FakeSubscription {
  id: string;
  status: 'APPROVAL_PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
  planId: string;
  customId: string;
  price: { value: string; currency_code: string };
  createTime: string;
  statusUpdateTime: string;
  payerId: string | null;
  lastPayment: { amount: { value: string; currency_code: string }; time: string } | null;
  nextBillingTime: string | null;
  failedPayments: number;
  transactions: { id: string; status: string; amount_with_breakdown: { gross_amount: { value: string; currency_code: string } }; time: string }[];
}

export class FakePayPal implements PayPalClient {
  readonly environment = 'sandbox' as const;
  readonly products = new Map<string, { id: string; name: string }>();
  readonly plans = new Map<string, { id: string; status: string; currency: string; value: string; productId: string }>();
  readonly subscriptions = new Map<string, FakeSubscription>();
  readonly webhooks: { id: string; url: string; event_types: { name: string }[] }[] = [];
  readonly calls: { method: string; path: string; body: unknown; requestId?: string }[] = [];
  /** PayPal's clock (tests set it to their own). */
  now: () => Date = () => new Date();
  /** Overrides the amount PayPal charges on approval (to test a price PayPal did not keep). */
  chargeOverride: string | null = null;
  /** The next call to a path matching this fails (once). */
  private failures: { match: RegExp; error: Error }[] = [];
  private byRequestId = new Map<string, unknown>();
  private counter = 0;

  failNext(match: RegExp, error: Error = new PayPalUnavailable('PayPal could not be reached (TimeoutError)')) {
    this.failures.push({ match, error });
  }

  async scopes() {
    return ['https://uri.paypal.com/services/subscriptions'];
  }

  private next(prefix: string) {
    this.counter += 1;
    return `${prefix}${String(this.counter).padStart(6, '0')}`;
  }

  private subscription(id: string): FakeSubscription {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'debug-404');
    return sub;
  }

  private view(sub: FakeSubscription) {
    return {
      id: sub.id,
      status: sub.status,
      status_update_time: sub.statusUpdateTime,
      create_time: sub.createTime,
      update_time: sub.statusUpdateTime,
      custom_id: sub.customId,
      plan_id: sub.planId,
      plan_overridden: true,
      plan: { billing_cycles: [{ sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { ...sub.price } } }] },
      subscriber: sub.payerId ? { payer_id: sub.payerId } : undefined,
      billing_info: sub.status === 'APPROVAL_PENDING' ? undefined : {
        last_payment: sub.lastPayment ?? undefined,
        next_billing_time: sub.status === 'ACTIVE' ? (sub.nextBillingTime ?? undefined) : undefined,
        failed_payments_count: sub.failedPayments,
      },
      links: [{ href: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-${sub.id}`, rel: 'approve', method: 'GET' }],
    };
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, options: RequestOptions = {}): Promise<T> {
    const body = options.rawJson ? JSON.parse(options.rawJson) : options.body;
    this.calls.push({ method, path, body, requestId: options.requestId });
    const failure = this.failures.findIndex((f) => f.match.test(`${method} ${path}`));
    if (failure >= 0) throw this.failures.splice(failure, 1)[0].error;
    if (options.requestId && this.byRequestId.has(`${path}:${options.requestId}`)) return this.byRequestId.get(`${path}:${options.requestId}`) as T;
    const result = this.handle(method, path, body as Record<string, unknown>);
    if (options.requestId) this.byRequestId.set(`${path}:${options.requestId}`, result);
    return result as T;
  }

  private handle(method: string, path: string, body: Record<string, unknown>): unknown {
    let match: RegExpExecArray | null;
    if (method === 'POST' && path === '/v1/catalogs/products') {
      const id = this.next('PROD-');
      this.products.set(id, { id, name: String(body.name) });
      return { id };
    }
    if (method === 'POST' && path === '/v1/billing/plans') {
      const id = this.next('P-');
      const cycle = (body.billing_cycles as { pricing_scheme: { fixed_price: { value: string; currency_code: string } } }[])[0];
      this.plans.set(id, { id, status: String(body.status ?? 'ACTIVE'), currency: cycle.pricing_scheme.fixed_price.currency_code, value: cycle.pricing_scheme.fixed_price.value, productId: String(body.product_id) });
      return { id, status: 'ACTIVE' };
    }
    if ((match = /^\/v1\/billing\/plans\/([^/]+)$/.exec(path)) && method === 'GET') {
      const plan = this.plans.get(decodeURIComponent(match[1]));
      if (!plan) throw new PayPalError(404, 'RESOURCE_NOT_FOUND', null, null);
      return { id: plan.id, status: plan.status };
    }
    if ((match = /^\/v1\/billing\/plans\/([^/]+)\/activate$/.exec(path)) && method === 'POST') {
      const plan = this.plans.get(decodeURIComponent(match[1]))!;
      plan.status = 'ACTIVE';
      return undefined;
    }
    if (method === 'POST' && path === '/v1/billing/subscriptions') {
      const planId = String(body.plan_id);
      const plan = this.plans.get(planId);
      if (!plan || plan.status !== 'ACTIVE') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'PLAN_STATUS_INVALID', null);
      const override = (body.plan as { billing_cycles?: { pricing_scheme?: { fixed_price?: { value: string; currency_code: string } } }[] } | undefined)?.billing_cycles?.[0]?.pricing_scheme?.fixed_price;
      if (override && override.currency_code !== plan.currency) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'CURRENCY_MISMATCH', null);
      const id = this.next('I-');
      const now = this.now().toISOString();
      const sub: FakeSubscription = {
        id,
        status: 'APPROVAL_PENDING',
        planId,
        customId: String(body.custom_id ?? ''),
        price: override ?? { value: plan.value, currency_code: plan.currency },
        createTime: now,
        statusUpdateTime: now,
        payerId: null,
        lastPayment: null,
        nextBillingTime: null,
        failedPayments: 0,
        transactions: [],
      };
      this.subscriptions.set(id, sub);
      return this.view(sub);
    }
    if ((match = /^\/v1\/billing\/subscriptions\/([^/]+)$/.exec(path)) && method === 'GET') {
      return this.view(this.subscription(decodeURIComponent(match[1])));
    }
    if ((match = /^\/v1\/billing\/subscriptions\/([^/]+)\/transactions$/.exec(path)) && method === 'GET') {
      return { transactions: this.subscription(decodeURIComponent(match[1])).transactions.map((t) => ({ ...t })) };
    }
    if ((match = /^\/v1\/billing\/subscriptions\/([^/]+)\/cancel$/.exec(path)) && method === 'POST') {
      const sub = this.subscription(decodeURIComponent(match[1]));
      if (sub.status !== 'ACTIVE' && sub.status !== 'SUSPENDED') throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'SUBSCRIPTION_STATUS_INVALID', null);
      if (!body?.reason) throw new PayPalError(400, 'INVALID_REQUEST', 'MISSING_REQUIRED_PARAMETER', null);
      sub.status = 'CANCELLED';
      sub.statusUpdateTime = this.now().toISOString();
      sub.nextBillingTime = null;
      return undefined;
    }
    if (method === 'GET' && path === '/v1/notifications/webhooks') return { webhooks: this.webhooks.map((w) => ({ ...w })) };
    if (method === 'POST' && path === '/v1/notifications/webhooks') {
      const hook = { id: this.next('WH'), url: String(body.url), event_types: body.event_types as { name: string }[] };
      this.webhooks.push(hook);
      return { id: hook.id };
    }
    if ((match = /^\/v1\/notifications\/webhooks\/([^/]+)$/.exec(path)) && method === 'PATCH') {
      const hook = this.webhooks.find((w) => w.id === decodeURIComponent(match![1]))!;
      hook.event_types = (body as unknown as { value: { name: string }[] }[])[0].value;
      return { id: hook.id };
    }
    throw new Error(`the fake PayPal does not handle ${method} ${path}`);
  }

  // ─── What the buyer and PayPal do ───

  /** The buyer approves; PayPal takes the first payment at `at` and schedules the next a month later. */
  approve(id: string, at: Date, payerId = 'PAYER1234567') {
    const sub = this.subscription(id);
    const value = this.chargeOverride ?? sub.price.value;
    sub.status = 'ACTIVE';
    sub.payerId = payerId;
    sub.statusUpdateTime = at.toISOString();
    this.pay(sub, at, value);
  }

  /** A renewal: the next payment is taken when it was due. */
  renew(id: string) {
    const sub = this.subscription(id);
    const due = new Date(sub.nextBillingTime!);
    this.pay(sub, due, sub.price.value);
  }

  /** A renewal fails; after PayPal's retries the subscription is suspended (threshold 1). */
  failRenewal(id: string, suspend: boolean) {
    const sub = this.subscription(id);
    const due = new Date(sub.nextBillingTime!);
    sub.failedPayments += 1;
    sub.transactions.push({ id: this.next('DECLINED-'), status: 'DECLINED', amount_with_breakdown: { gross_amount: { ...sub.price } }, time: due.toISOString() });
    if (suspend) {
      sub.status = 'SUSPENDED';
      sub.statusUpdateTime = new Date(due.getTime() + 10 * 86_400_000).toISOString();
    }
  }

  /** The buyer cancels from their own PayPal account. */
  cancelByBuyer(id: string, at: Date) {
    const sub = this.subscription(id);
    sub.status = 'CANCELLED';
    sub.statusUpdateTime = at.toISOString();
    sub.nextBillingTime = null;
  }

  private pay(sub: FakeSubscription, at: Date, value: string) {
    const amount = { value, currency_code: sub.price.currency_code };
    sub.transactions.push({ id: this.next('SALE-'), status: 'COMPLETED', amount_with_breakdown: { gross_amount: amount }, time: at.toISOString() });
    sub.lastPayment = { amount, time: at.toISOString() };
    sub.nextBillingTime = addMonth(at).toISOString();
    sub.failedPayments = 0;
  }
}
