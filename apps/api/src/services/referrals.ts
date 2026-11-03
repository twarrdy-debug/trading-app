import {
  type BillingCurrency,
  normalizeReferralCode,
  REFERRAL_HOLD_DAYS,
  REFERRAL_MONTHS,
  type ReferralPlan,
  type ReferralStatus,
} from '@trading/shared';
import { and, asc, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db/client.ts';
import { referralCommissions, referralPartners, subscriptions, users } from '../db/schema.ts';
import { HttpError } from '../errors.ts';
import type { BillingProvider } from './billing.ts';

const DAY_MS = 86_400_000;

export interface PaidInvoice {
  invoiceId: string;
  customerId: string;
  /** Minor units. */
  amount: number;
  currency: string;
  paidAt: Date;
  plan: ReferralPlan;
}

export interface RefundedPayment {
  paymentIntentId: string;
  /** Minor units, everything refunded on this payment so far. */
  refunded: number;
}

type Commission = typeof referralCommissions.$inferSelect;

const share = (minor: number, percent: number) => Math.round((minor * percent) / 100);

function statusOf(row: Commission, now: Date): ReferralStatus {
  if (row.clawbackOf) return 'clawback';
  if (row.refunded > 0 && row.commission === 0) return 'refunded';
  if (row.paidOutAt) return 'paidOut';
  return row.availableAt <= now ? 'ready' : 'waiting';
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** An active partner's code, for sign-up. */
export async function findPartnerByCode(db: DB, code: unknown) {
  if (typeof code !== 'string' || code.trim() === '') return null;
  const [partner] = await db
    .select()
    .from(referralPartners)
    .where(and(eq(referralPartners.code, normalizeReferralCode(code)), eq(referralPartners.active, true)));
  return partner ?? null;
}

/**
 * Called for every paid invoice; repeats do nothing, because the invoice id is unique. Only an
 * account referred at sign-up earns, and only for a year from its first purchase.
 */
export async function recordPayment(db: DB, invoice: PaidInvoice, log: FastifyBaseLogger) {
  if (invoice.amount <= 0) return;
  const [customer] = await db
    .select({ id: users.id, referredBy: users.referredBy })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(eq(subscriptions.stripeCustomerId, invoice.customerId));
  if (!customer?.referredBy) return;
  const [partner] = await db.select().from(referralPartners).where(eq(referralPartners.userId, customer.referredBy));
  if (!partner) {
    log.warn({ partner: customer.referredBy }, 'referred customer paid, but the partner has no record');
    return;
  }
  const [first] = await db
    .select({ paidAt: referralCommissions.paidAt })
    .from(referralCommissions)
    .where(and(eq(referralCommissions.customerId, customer.id), isNull(referralCommissions.clawbackOf)))
    .orderBy(asc(referralCommissions.paidAt))
    .limit(1);
  if (first && invoice.paidAt >= addMonths(first.paidAt, REFERRAL_MONTHS)) return;

  await db
    .insert(referralCommissions)
    .values({
      partnerId: partner.userId,
      customerId: customer.id,
      stripeInvoiceId: invoice.invoiceId,
      plan: invoice.plan,
      currency: invoice.currency as BillingCurrency,
      paid: invoice.amount,
      percent: partner.percent,
      commission: share(invoice.amount, partner.percent),
      paidAt: invoice.paidAt,
      availableAt: new Date(invoice.paidAt.getTime() + REFERRAL_HOLD_DAYS * DAY_MS),
    })
    .onConflictDoNothing({ target: referralCommissions.stripeInvoiceId });
}

/**
 * Called for every refund. Stripe reports the total refunded so far, so repeats change nothing.
 * Before a payout the commission shrinks; after one the difference is taken from the next payout.
 */
export async function recordRefund(db: DB, billing: BillingProvider, refund: RefundedPayment, log: FastifyBaseLogger) {
  const invoiceId = await billing.invoiceOfPayment(refund.paymentIntentId);
  if (!invoiceId) return;
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(referralCommissions).where(eq(referralCommissions.stripeInvoiceId, invoiceId));
    if (!row) return;
    const owed = share(Math.max(0, row.paid - refund.refunded), row.percent);
    if (!row.paidOutAt) {
      await tx.update(referralCommissions).set({ refunded: refund.refunded, commission: owed }).where(eq(referralCommissions.id, row.id));
      return;
    }
    const [taken] = await tx
      .select({ sum: sql<number>`coalesce(sum(${referralCommissions.commission}), 0)::int` })
      .from(referralCommissions)
      .where(eq(referralCommissions.clawbackOf, row.id));
    const difference = owed - (row.commission + (taken?.sum ?? 0));
    if (difference >= 0) return;
    const now = new Date();
    await tx
      .insert(referralCommissions)
      .values({
        partnerId: row.partnerId,
        customerId: row.customerId,
        stripeInvoiceId: `${invoiceId}:clawback:${refund.refunded}`,
        clawbackOf: row.id,
        plan: row.plan,
        currency: row.currency,
        paid: 0,
        refunded: refund.refunded,
        percent: row.percent,
        commission: difference,
        paidAt: now,
        availableAt: now,
      })
      .onConflictDoNothing({ target: referralCommissions.stripeInvoiceId });
    log.info({ invoice: invoiceId, difference }, 'commission taken back after a refund');
  });
}

type Totals = { currency: BillingCurrency; ready: number; waiting: number; paidOut: number };

/** Money per currency, in major units for the clients. A commission stays in the currency it was paid in. */
function totalsOf(rows: Commission[], now: Date): Totals[] {
  const byCurrency = new Map<BillingCurrency, Totals>();
  for (const row of rows) {
    const total = byCurrency.get(row.currency) ?? { currency: row.currency, ready: 0, waiting: 0, paidOut: 0 };
    byCurrency.set(row.currency, total);
    if (row.paidOutAt) total.paidOut += row.commission;
    else if (row.availableAt <= now) total.ready += row.commission;
    else total.waiting += row.commission;
  }
  return [...byCurrency.values()].map((t) => ({ ...t, ready: t.ready / 100, waiting: t.waiting / 100, paidOut: t.paidOut / 100 }));
}

const countsCustomer = (row: Commission) => !row.clawbackOf && row.refunded < row.paid;

/** The partner's own panel: numbers only, nothing that names a customer. Null for everyone else. */
export async function partnerPanel(db: DB, userId: string, now = new Date()) {
  const [partner] = await db.select().from(referralPartners).where(eq(referralPartners.userId, userId));
  if (!partner) return { partner: null };
  const rows = await db.select().from(referralCommissions).where(eq(referralCommissions.partnerId, userId)).orderBy(desc(referralCommissions.paidAt));
  const [signups] = await db.select({ value: count() }).from(users).where(eq(users.referredBy, userId));
  return {
    partner: {
      code: partner.code,
      percent: partner.percent,
      active: partner.active,
      signups: signups?.value ?? 0,
      customers: new Set(rows.filter(countsCustomer).map((r) => r.customerId)).size,
      totals: totalsOf(rows, now),
      sales: rows.slice(0, 100).map((row) => ({
        id: row.id,
        paidAt: row.paidAt,
        plan: row.plan,
        currency: row.currency,
        paid: row.paid / 100,
        commission: row.commission / 100,
        availableAt: row.availableAt,
        status: statusOf(row, now),
      })),
    },
  };
}
export type PartnerPanel = Awaited<ReturnType<typeof partnerPanel>>;

/** Admin → Partners: everyone who may refer, with what is due to each. */
export async function listPartners(db: DB, now = new Date()) {
  const partners = await db
    .select({
      userId: referralPartners.userId,
      code: referralPartners.code,
      percent: referralPartners.percent,
      active: referralPartners.active,
      name: users.displayName,
      email: users.email,
    })
    .from(referralPartners)
    .innerJoin(users, eq(users.id, referralPartners.userId))
    .orderBy(asc(referralPartners.createdAt));
  if (partners.length === 0) return [];
  const ids = partners.map((p) => p.userId);
  const rows = await db.select().from(referralCommissions).where(inArray(referralCommissions.partnerId, ids));
  const signups = await db.select({ partner: users.referredBy, value: count() }).from(users).where(inArray(users.referredBy, ids)).groupBy(users.referredBy);
  return partners.map((partner) => {
    const own = rows.filter((r) => r.partnerId === partner.userId);
    return {
      ...partner,
      signups: signups.find((s) => s.partner === partner.userId)?.value ?? 0,
      customers: new Set(own.filter(countsCustomer).map((r) => r.customerId)).size,
      totals: totalsOf(own, now),
    };
  });
}

export async function createPartner(db: DB, input: { email: string; code: string; percent: number }) {
  const [user] = await db.select({ id: users.id, demo: users.demo }).from(users).where(eq(users.email, input.email));
  if (!user || user.demo) throw new HttpError(404, 'referralUserMissing');
  const [existing] = await db.select({ userId: referralPartners.userId }).from(referralPartners).where(eq(referralPartners.userId, user.id));
  if (existing) throw new HttpError(409, 'referralPartnerExists');
  const [taken] = await db.select({ userId: referralPartners.userId }).from(referralPartners).where(eq(referralPartners.code, input.code));
  if (taken) throw new HttpError(409, 'referralCodeTaken');
  await db.insert(referralPartners).values({ userId: user.id, code: input.code, percent: input.percent });
  return { created: true };
}

/** A new percent applies to later payments; what is already counted keeps its own. */
export async function updatePartner(db: DB, userId: string, patch: { percent?: number; active?: boolean }) {
  const [row] = await db.update(referralPartners).set(patch).where(eq(referralPartners.userId, userId)).returning({ userId: referralPartners.userId });
  if (!row) throw new HttpError(404, 'notFound');
  return { updated: true };
}

/** Marks what is ready in one currency as transferred; the transfer itself is made by hand. */
export async function markPayout(db: DB, userId: string, currency: BillingCurrency, now = new Date()) {
  return db.transaction(async (tx) => {
    const due = and(
      eq(referralCommissions.partnerId, userId),
      eq(referralCommissions.currency, currency),
      isNull(referralCommissions.paidOutAt),
      lte(referralCommissions.availableAt, now),
    );
    const [sum] = await tx.select({ value: sql<number>`coalesce(sum(${referralCommissions.commission}), 0)::int` }).from(referralCommissions).where(due);
    const amount = sum?.value ?? 0;
    if (amount <= 0) throw new HttpError(400, 'referralNothingToPay');
    await tx.update(referralCommissions).set({ paidOutAt: now }).where(due);
    return { amount: amount / 100, currency };
  });
}
