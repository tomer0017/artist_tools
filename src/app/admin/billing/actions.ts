'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { mayChangeRoles } from '@/server/admin';
import { getPayPalClient } from '@/server/billing/paypal/client';
import { reconcilePayPal, setBillingAccess } from '@/server/billing/paypal/subscriptions';
import { closeRefundRequest } from '@/server/billing/refunds';
import { getDb } from '@/server/db/client';
import { currentAdmin } from '@/server/session';
import type { ActionResult } from '../actions';

// Billing controls (docs/billing/03-paypal.md). Who may subscribe and refund
// decisions are the owner's (anyone's, until an owner is set); checking with
// PayPal now is any admin's. Every change is audited by the operation it calls.

const DENIED: ActionResult = { ok: false, message: 'You are not allowed to do that.' };
const OWNER_ONLY: ActionResult = { ok: false, message: 'Only the owner can change this.' };

async function owner() {
  const admin = await currentAdmin();
  if (!admin) return { refusal: DENIED };
  if (!(await mayChangeRoles(getDb(), admin.id))) return { refusal: OWNER_ONLY };
  return { admin };
}

const AccessInput = z.object({ openToEveryone: z.boolean(), testerEmails: z.string().max(5000) }).strict();

export async function saveBillingAccess(input: unknown): Promise<ActionResult> {
  const who = await owner();
  if ('refusal' in who) return who.refusal;
  const parsed = AccessInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That request was not valid.' };
  const emails = (parsed.data.testerEmails ?? '').split(/[\s,;]+/).filter(Boolean);
  await setBillingAccess(getDb(), { openToEveryone: parsed.data.openToEveryone === true, testerEmails: emails }, `admin:${who.admin.id.toHexString()}`);
  revalidatePath('/admin/billing');
  return { ok: true, message: parsed.data.openToEveryone ? 'Subscriptions are open to everyone.' : 'Subscriptions are open to administrators and the listed testers only.' };
}

const DecisionInput = z.object({ requestId: z.string().regex(/^[0-9a-f]{24}$/), outcome: z.enum(['refunded', 'declined']), note: z.string().max(500).optional() }).strict();

export async function decideRefund(input: unknown): Promise<ActionResult> {
  const who = await owner();
  if ('refusal' in who) return who.refusal;
  const parsed = DecisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'That request was not valid.' };
  const closed = await closeRefundRequest(getDb(), parsed.data.requestId!, parsed.data.outcome!, parsed.data.note ?? null, `admin:${who.admin.id.toHexString()}`);
  revalidatePath('/admin/billing');
  if (closed === 'not_found') return { ok: false, message: 'That request is no longer open.' };
  return { ok: true, message: parsed.data.outcome === 'refunded' ? 'Marked as refunded.' : 'Declined.' };
}

export async function checkWithPayPal(): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return DENIED;
  let client;
  try {
    client = getPayPalClient();
  } catch {
    client = null;
  }
  if (!client) return { ok: false, message: 'PayPal is not set up on this server.' };
  const run = await reconcilePayPal(getDb(), client, `admin:${admin.id.toHexString()}`);
  revalidatePath('/admin/billing');
  return { ok: true, message: `${run.checked} checked with PayPal, ${run.fixed.length} corrected, ${run.missing.length} not found.` };
}
