import {
  type BillingCurrency,
  type BillingInterval,
  FOUNDER_CODE,
  FOUNDER_SEATS,
  PRO_PRICES,
  subscriptionGivesPro,
} from '@trading/shared';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import Stripe from 'stripe';
import type { DB } from '../db/client.ts';
import { subscriptions, users } from '../db/schema.ts';
import { HttpError } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

/** Stripe's names for what `npm run stripe:setup` creates; prices are found by these. */
export const PRICE_KEYS: Record<BillingInterval, string> = { month: 'pro_month', year: 'pro_year' };
export const FOUNDER_COUPON = 'founders-first-year';

export interface BillingSubscription {
  id: string;
  customerId: string;
  status: string;
  interval: BillingInterval | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  founder: boolean;
}

export interface CheckoutRequest {
  customerId: string;
  userId: string;
  interval: BillingInterval;
  currency: BillingCurrency;
  language: string;
  successUrl: string;
  cancelUrl: string;
}

/** What the app needs from the payment provider; tests inject a fake one through `buildApp({ billing })`. */
export interface BillingProvider {
  createCustomer(input: { email: string | null; name: string; userId: string }): Promise<string>;
  checkout(input: CheckoutRequest): Promise<{ id: string; url: string }>;
  expireCheckout(id: string): Promise<void>;
  portal(customerId: string, returnUrl: string): Promise<string>;
  /** Checks the signature (throws when it is wrong) and names the subscription the event concerns. */
  parseEvent(rawBody: Buffer, signature: string): { subscriptionId: string | null };
  subscription(id: string): Promise<BillingSubscription | null>;
  cancel(id: string): Promise<void>;
  founderSeatsLeft(): Promise<number>;
}

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : (value?.id ?? null));

export function stripeBilling(secretKey: string, webhookSecret: string): BillingProvider {
  const stripe = new Stripe(secretKey);
  const prices = new Map<BillingInterval, string>();
  let seats: { left: number; at: number } | null = null;

  const priceId = async (interval: BillingInterval) => {
    const known = prices.get(interval);
    if (known) return known;
    const found = await stripe.prices.list({ lookup_keys: [PRICE_KEYS[interval]], active: true, limit: 1 });
    const id = found.data[0]?.id;
    if (!id) throw new Error(`no Stripe price ${PRICE_KEYS[interval]}: run npm run stripe:setup`);
    prices.set(interval, id);
    return id;
  };

  return {
    async createCustomer({ email, name, userId }) {
      return (await stripe.customers.create({ email: email ?? undefined, name, metadata: { userId } })).id;
    },
    async checkout({ customerId, userId, interval, currency, language, successUrl, cancelUrl }) {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        currency,
        locale: language === 'pl' ? 'pl' : 'en',
        line_items: [{ price: await priceId(interval), quantity: 1 }],
        // The buyer types the founders' code on Stripe's page; Stripe checks its limits.
        allow_promotion_codes: true,
        subscription_data: { metadata: { userId } },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error('Stripe returned a checkout without an address');
      return { id: session.id, url: session.url };
    },
    async expireCheckout(id) {
      await stripe.checkout.sessions.expire(id);
    },
    async portal(customerId, returnUrl) {
      return (await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })).url;
    },
    parseEvent(rawBody, signature) {
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      switch (event.type) {
        case 'checkout.session.completed':
          return { subscriptionId: idOf(event.data.object.subscription) };
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          return { subscriptionId: event.data.object.id };
        default:
          return { subscriptionId: null };
      }
    },
    async subscription(id) {
      const sub = await stripe.subscriptions.retrieve(id, { expand: ['latest_invoice.discounts'] });
      const item = sub.items.data[0];
      const interval = item?.price.recurring?.interval as string | undefined;
      return {
        id: sub.id,
        customerId: idOf(sub.customer)!,
        status: sub.status,
        interval: interval === 'month' || interval === 'year' ? interval : null,
        currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        // On the first invoice: Stripe takes a one-time discount off the subscription once it is used.
        // A later invoice has none, but `syncSubscription` keeps what it saw.
        founder:
          typeof sub.latest_invoice === 'object' &&
          (sub.latest_invoice?.discounts ?? []).some((d) => {
            if (typeof d === 'string') return false;
            const coupon = d.source.coupon;
            return (typeof coupon === 'string' ? coupon : coupon?.id) === FOUNDER_COUPON;
          }),
      };
    },
    async cancel(id) {
      await stripe.subscriptions.cancel(id);
    },
    async founderSeatsLeft() {
      // Asked on every look at the prices, so a minute old is fine; Stripe enforces the real limit.
      if (seats && Date.now() - seats.at < 60_000) return seats.left;
      const coupon = await stripe.coupons.retrieve(FOUNDER_COUPON).catch(() => null);
      const left = coupon?.valid ? Math.max(0, (coupon.max_redemptions ?? FOUNDER_SEATS) - coupon.times_redeemed) : 0;
      seats = { left, at: Date.now() };
      return left;
    },
  };
}

const rowOf = async (db: DB, userId: string) => (await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)))[0];

/** Provider failures reach the user as one calm message; the cause goes to the log. */
async function outside<T>(log: FastifyBaseLogger, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    log.error(err, 'payment provider');
    throw new HttpError(502, 'billingError');
  }
}

export async function billingState(billing: BillingProvider | null, db: DB, user: CurrentUser, demo: boolean, log: FastifyBaseLogger) {
  const row = await rowOf(db, user.id);
  const left = billing ? await billing.founderSeatsLeft().catch((err) => (log.error(err, 'payment provider'), 0)) : 0;
  const started = row?.status != null;
  return {
    available: billing != null && !demo,
    /** Only a free Standard account buys: Pro given for free stays free, and an admin needs nothing. */
    canBuy: billing != null && !demo && user.role === 'standard' && !subscriptionGivesPro(row?.status),
    prices: PRO_PRICES,
    // Stripe takes the code only from a customer who has never paid.
    founder: { code: FOUNDER_CODE, total: FOUNDER_SEATS, left, usable: left > 0 && !started },
    subscription: started
      ? {
          status: row.status!,
          active: subscriptionGivesPro(row.status),
          interval: row.interval,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          founder: row.founder,
        }
      : null,
  };
}
export type BillingState = Awaited<ReturnType<typeof billingState>>;

export async function startCheckout(
  billing: BillingProvider | null,
  db: DB,
  user: CurrentUser,
  publicUrl: string,
  { interval, currency }: { interval: BillingInterval; currency?: BillingCurrency },
  log: FastifyBaseLogger,
) {
  if (!billing) throw new HttpError(404, 'billingOff');
  if (user.role !== 'standard') throw new HttpError(409, 'billingNotStandard');
  const row = await rowOf(db, user.id);
  if (subscriptionGivesPro(row?.status)) throw new HttpError(409, 'billingActive');

  return outside(log, async () => {
    let customerId = row?.stripeCustomerId;
    if (!customerId) {
      customerId = await billing.createCustomer({ email: user.email, name: user.displayName, userId: user.id });
      await db.insert(subscriptions).values({ userId: user.id, stripeCustomerId: customerId });
    }
    // An older tab's checkout must not stay payable next to this one: that would be two subscriptions.
    if (row?.stripeCheckoutId) await billing.expireCheckout(row.stripeCheckoutId).catch(() => undefined);
    const page = `${publicUrl}/ustawienia/subskrypcja`;
    const session = await billing.checkout({
      customerId,
      userId: user.id,
      interval,
      currency: currency ?? (user.language === 'pl' ? 'pln' : 'usd'),
      language: user.language,
      successUrl: `${page}?checkout=done`,
      cancelUrl: `${page}?checkout=cancelled`,
    });
    await db.update(subscriptions).set({ stripeCheckoutId: session.id }).where(eq(subscriptions.userId, user.id));
    return { url: session.url };
  });
}

export async function openPortal(billing: BillingProvider | null, db: DB, user: CurrentUser, publicUrl: string, log: FastifyBaseLogger) {
  if (!billing) throw new HttpError(404, 'billingOff');
  const row = await rowOf(db, user.id);
  if (!row?.status) throw new HttpError(404, 'billingNoCustomer');
  return { url: await outside(log, () => billing.portal(row.stripeCustomerId, `${publicUrl}/ustawienia/subskrypcja`)) };
}

/**
 * Brings our copy and the user's role in line with Stripe. It always reads the subscription afresh,
 * so events arriving twice or out of order do no harm. Only what a subscription granted is taken
 * back: Pro from an admin or an invitation never is.
 */
export async function syncSubscription(billing: BillingProvider, db: DB, subscriptionId: string, log: FastifyBaseLogger) {
  const sub = await billing.subscription(subscriptionId);
  if (!sub) return;
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, sub.customerId));
  if (!row) {
    log.warn({ customer: sub.customerId }, 'Stripe subscription of an unknown customer');
    return;
  }
  const entitled = subscriptionGivesPro(sub.status);
  if (row.stripeSubscriptionId && row.stripeSubscriptionId !== sub.id && subscriptionGivesPro(row.status)) {
    // The end of an older subscription says nothing about the one in force.
    if (!entitled) return;
    log.error({ user: row.userId, kept: sub.id, other: row.stripeSubscriptionId }, 'two active subscriptions: refund one in Stripe');
  }
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ role: users.role }).from(users).where(eq(users.id, row.userId));
    let grantedPro = row.grantedPro;
    if (entitled && user?.role === 'standard') {
      await tx.update(users).set({ role: 'pro' }).where(eq(users.id, row.userId));
      grantedPro = true;
    } else if (!entitled && grantedPro) {
      // An admin may have moved the user to VIP meanwhile; that stays.
      if (user?.role === 'pro') await tx.update(users).set({ role: 'standard' }).where(eq(users.id, row.userId));
      grantedPro = false;
    }
    await tx
      .update(subscriptions)
      .set({
        stripeSubscriptionId: sub.id,
        stripeCheckoutId: null,
        status: sub.status,
        interval: sub.interval,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        founder: row.founder || sub.founder,
        grantedPro,
      })
      .where(eq(subscriptions.userId, row.userId));
  });
}

/** Ends a user's paid subscription at once (their account is being deleted). */
export async function stopPayments(db: DB, billing: BillingProvider | null, userId: string) {
  const row = await rowOf(db, userId);
  if (!row?.stripeSubscriptionId || !subscriptionGivesPro(row.status)) return;
  if (!billing) throw new HttpError(409, 'billingOff');
  try {
    await billing.cancel(row.stripeSubscriptionId);
  } catch {
    throw new HttpError(502, 'billingError');
  }
}
