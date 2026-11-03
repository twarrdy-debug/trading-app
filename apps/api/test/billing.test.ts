import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { subscriptions, users } from '../src/db/schema.ts';
import { seed } from '../src/db/seed-data.ts';
import { loadEnv } from '../src/env.ts';
import type { BillingProvider, BillingSubscription, CheckoutRequest } from '../src/services/billing.ts';

/** Offline Stripe: subscriptions are set by the test, the signature is the word "good". */
const stripe = {
  subs: new Map<string, BillingSubscription>(),
  checkouts: [] as CheckoutRequest[],
  expired: [] as string[],
  cancelled: [] as string[],
  seats: 2,
  down: false,
  customers: 0,
};
const billing: BillingProvider = {
  async createCustomer() {
    if (stripe.down) throw new Error('offline');
    return `cus_${++stripe.customers}`;
  },
  async checkout(input) {
    stripe.checkouts.push(input);
    return { id: `cs_${stripe.checkouts.length}`, url: `https://stripe.test/${stripe.checkouts.length}` };
  },
  async expireCheckout(id) {
    stripe.expired.push(id);
  },
  async portal(customer) {
    return `https://stripe.test/portal/${customer}`;
  },
  parseEvent(body, signature) {
    if (signature !== 'good') throw new Error('bad signature');
    return JSON.parse(body.toString()) as { subscriptionId: string | null };
  },
  async subscription(id) {
    return stripe.subs.get(id) ?? null;
  },
  async cancel(id) {
    stripe.cancelled.push(id);
  },
  async founderSeatsLeft() {
    return stripe.seats;
  },
};

let app: App;
let database: Database;
let uploadDir: string;
let n = 0;

beforeAll(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), 'trading-billing-'));
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'memory://', UPLOAD_DIR: uploadDir });
  database = createDatabase(env.DATABASE_URL);
  await database.migrate();
  await seed(database.db, env.DEV_USER_EMAIL);
  app = await buildApp({ db: database.db, env, billing, logger: false });
});
afterAll(async () => {
  await app.close();
  await database.close();
  rmSync(uploadDir, { recursive: true, force: true });
});
beforeEach(() => {
  stripe.checkouts = [];
  stripe.expired = [];
  stripe.cancelled = [];
  stripe.seats = 2;
  stripe.down = false;
});

const newUser = async (role: 'standard' | 'pro' | 'vip' = 'standard', language: 'pl' | 'en' = 'pl') => {
  const [user] = await database.db.insert(users).values({ email: `b${++n}@test.local`, displayName: 'Buyer', role, language }).returning();
  return user!;
};
const headers = (id: string) => ({ 'x-user-id': id });
const roleOf = async (id: string) => (await database.db.select({ role: users.role }).from(users).where(eq(users.id, id)))[0]!.role;
const rowOf = async (id: string) => (await database.db.select().from(subscriptions).where(eq(subscriptions.userId, id)))[0]!;
const checkout = (id: string, interval: 'month' | 'year' = 'month') => app.inject({ method: 'POST', url: '/billing/checkout', headers: headers(id), payload: { interval } });
const webhook = (subscriptionId: string | null, signature = 'good') =>
  app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload: JSON.stringify({ subscriptionId }) });

/** Buys, then Stripe reports the subscription in the given state. */
const buy = async (id: string, sub: Partial<BillingSubscription> = {}) => {
  await checkout(id, sub.interval ?? 'month');
  const row = await rowOf(id);
  const subId = sub.id ?? `sub_${row.stripeCustomerId}`;
  stripe.subs.set(subId, { id: subId, customerId: row.stripeCustomerId, status: 'active', interval: 'month', currentPeriodEnd: new Date('2027-01-01T00:00:00Z'), cancelAtPeriodEnd: false, founder: false, ...sub });
  expect((await webhook(subId)).statusCode).toBe(200);
  return subId;
};

describe('buying Pro', () => {
  it('turns a Standard account into Pro, and back when the subscription ends', async () => {
    const user = await newUser();
    const before = (await app.inject({ url: '/billing', headers: headers(user.id) })).json();
    expect(before).toMatchObject({ available: true, canBuy: true, subscription: null, prices: { usd: { month: 15, year: 120, founderYear: 15 } } });

    const res = await checkout(user.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toContain('https://stripe.test/');
    expect(await roleOf(user.id)).toBe('standard');

    const subId = await buy(user.id);
    expect(await roleOf(user.id)).toBe('pro');
    const state = (await app.inject({ url: '/billing', headers: headers(user.id) })).json();
    expect(state).toMatchObject({ canBuy: false, subscription: { status: 'active', active: true, interval: 'month' } });
    expect(JSON.stringify(state)).not.toContain('cus_');

    stripe.subs.get(subId)!.status = 'past_due';
    await webhook(subId);
    expect(await roleOf(user.id)).toBe('pro');

    stripe.subs.get(subId)!.status = 'canceled';
    await webhook(subId);
    await webhook(subId);
    expect(await roleOf(user.id)).toBe('standard');
    expect((await app.inject({ url: '/billing', headers: headers(user.id) })).json().canBuy).toBe(true);
  });

  it('never takes away Pro it did not give', async () => {
    const user = await newUser();
    const subId = await buy(user.id);
    await database.db.update(users).set({ role: 'vip' }).where(eq(users.id, user.id));
    stripe.subs.get(subId)!.status = 'canceled';
    await webhook(subId);
    expect(await roleOf(user.id)).toBe('vip');
  });

  it('sells nothing to free Pro, VIP or an account already paying', async () => {
    for (const role of ['pro', 'vip'] as const) {
      const user = await newUser(role);
      expect((await checkout(user.id)).statusCode).toBe(409);
      expect((await app.inject({ url: '/billing', headers: headers(user.id) })).json().canBuy).toBe(false);
      expect(await roleOf(user.id)).toBe(role);
    }
    const payer = await newUser();
    await buy(payer.id);
    await database.db.update(users).set({ role: 'standard' }).where(eq(users.id, payer.id));
    const res = await checkout(payer.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('billingActive');
  });

  it('picks the currency by language and offers the founders code only to someone who never paid', async () => {
    const state = async (id: string) => (await app.inject({ url: '/billing', headers: headers(id) })).json();
    const user = await newUser('standard', 'en');
    expect((await state(user.id)).founder).toEqual({ code: 'FOUNDERS', total: 50, left: 2, usable: true });
    await checkout(user.id, 'month');
    expect(stripe.checkouts.at(-1)).toMatchObject({ currency: 'usd' });
    const polish = await newUser();
    await checkout(polish.id, 'year');
    expect(stripe.checkouts.at(-1)).toMatchObject({ currency: 'pln', interval: 'year' });

    stripe.seats = 0;
    expect((await state(user.id)).founder.usable).toBe(false);
    stripe.seats = 2;

    const subId = await buy(user.id, { interval: 'year', founder: true });
    stripe.subs.get(subId)!.status = 'canceled';
    await webhook(subId);
    expect((await rowOf(user.id)).founder).toBe(true);
    expect((await state(user.id)).founder.usable).toBe(false);
  });

  it('closes an earlier checkout when another starts, so nobody pays twice', async () => {
    const user = await newUser();
    await checkout(user.id);
    const first = (await rowOf(user.id)).stripeCheckoutId!;
    await checkout(user.id);
    expect(stripe.expired).toContain(first);
  });

  it('ignores the end of an older subscription', async () => {
    const user = await newUser();
    const old = await buy(user.id, { id: 'sub_old' });
    stripe.subs.set('sub_new', { ...stripe.subs.get(old)!, id: 'sub_new' });
    await webhook('sub_new');
    stripe.subs.get(old)!.status = 'canceled';
    await webhook(old);
    expect(await roleOf(user.id)).toBe('pro');
    expect((await rowOf(user.id)).stripeSubscriptionId).toBe('sub_new');
  });
});

describe('the webhook', () => {
  it('needs no session but refuses a wrong or missing signature', async () => {
    const user = await newUser();
    const subId = await buy(user.id);
    stripe.subs.get(subId)!.status = 'canceled';
    expect((await webhook(subId, 'forged')).statusCode).toBe(400);
    const unsigned = await app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(unsigned.statusCode).toBe(400);
    expect(await roleOf(user.id)).toBe('pro');
  });

  it('accepts events about nothing we know', async () => {
    expect((await webhook(null)).statusCode).toBe(200);
    expect((await webhook('sub_unknown')).statusCode).toBe(200);
  });
});

describe('managing and deleting', () => {
  it('opens the customer portal only after a purchase', async () => {
    const user = await newUser();
    expect((await app.inject({ method: 'POST', url: '/billing/portal', headers: headers(user.id) })).statusCode).toBe(404);
    await checkout(user.id);
    expect((await app.inject({ method: 'POST', url: '/billing/portal', headers: headers(user.id) })).statusCode).toBe(404);
    await buy(user.id);
    const res = await app.inject({ method: 'POST', url: '/billing/portal', headers: headers(user.id) });
    expect(res.json().url).toContain('https://stripe.test/portal/');
  });

  it('answers calmly when Stripe is down', async () => {
    stripe.down = true;
    const user = await newUser();
    const res = await checkout(user.id);
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('billingError');
  });

  it('cancels the payments when an admin deletes the user', async () => {
    const user = await newUser();
    const subId = await buy(user.id);
    expect((await app.inject({ method: 'DELETE', url: `/admin/users/${user.id}` })).statusCode).toBe(200);
    expect(stripe.cancelled).toEqual([subId]);
  });
});
