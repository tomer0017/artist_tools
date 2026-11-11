import 'server-only';
import { z } from 'zod';
import { CURRENCIES } from '@/lib/locale';
import type { ConfigSpec } from './versions';

// ─── Prices (docs/adr/0007) ───────────────────────────────────────────────────
// Price entries for paid plans: one per plan, interval and currency, as an
// integer amount in minor units (cents, agorot) — no floats, no exchange-rate
// conversion. Published prices are not shown to anyone until paid plans launch
// (Phase 4); version 1 has no prices at all, because none have been decided.

export const PRICE_INTERVALS = ['month', 'year'] as const;

const Price = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'use 2–40 lowercase letters, digits, - or _'),
  planId: z.literal('pro'),
  interval: z.enum(PRICE_INTERVALS),
  currency: z.enum(CURRENCIES),
  amountMinor: z.number().int().min(0).max(100_000_000),
  trialDays: z.number().int().min(0).max(90).nullable(),
  active: z.boolean(),
  /** Ids of this price at payment providers, filled in Phase 4. */
  providerRefs: z.record(z.string(), z.string()).default({}),
});

export const PricingSchema = z
  .object({ prices: z.array(Price).max(50) })
  .superRefine((pricing, ctx) => {
    const ids = new Set<string>();
    const slots = new Set<string>();
    pricing.prices.forEach((price, i) => {
      if (ids.has(price.id)) ctx.addIssue({ code: 'custom', path: ['prices', i, 'id'], message: 'is used twice' });
      ids.add(price.id);
      const slot = `${price.planId}:${price.interval}:${price.currency}`;
      if (price.active && slots.has(slot)) ctx.addIssue({ code: 'custom', path: ['prices', i], message: `two active prices for ${slot}` });
      if (price.active) slots.add(slot);
    });
  });

export type Pricing = z.infer<typeof PricingSchema>;
export type Price = z.infer<typeof Price>;

export const pricingSpec: ConfigSpec<Pricing> = {
  kind: 'pricing',
  schema: PricingSchema,
  defaults: () => ({ prices: [] }),
};

export { formatMoney, minorDigits, toMinor } from '@/lib/money';
