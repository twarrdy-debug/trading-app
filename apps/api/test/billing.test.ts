import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { referralCommissions, referralPartners, subscriptions, users } from '../src/db/schema.ts';
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
  payments: new Map<string, string>(),
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
    const event = JSON.parse(body.toString()) as ReturnType<BillingProvider['parseEvent']>;
    if (event.payment) event.payment.paidAt = new Date(event.payment.paidAt);
    return event;
  },
  async subscription(id) {
    return stripe.subs.get(id) ?? null;
  },
  async invoiceOfPayment(id) {
    return stripe.payments.get(id) ?? null;
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
const checkout = (id: string, interval: 'month' | 'year' = 'month') => app.inject({ method: 'POST', url: '/billing/checkout', headers: headers(id), payload: { interval, acceptedTerms: true } });
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

describe('the Terms', () => {
  it('must be ticked to buy, and the acceptance is kept', async () => {
    const user = await newUser();
    const refused = await app.inject({ method: 'POST', url: '/billing/checkout', headers: headers(user.id), payload: { interval: 'month' } });
    expect(refused.statusCode).toBe(400);
    expect((await checkout(user.id)).statusCode).toBe(200);
    const [row] = await database.db.select({ at: users.termsAcceptedAt }).from(users).where(eq(users.id, user.id));
    expect(row!.at).toBeInstanceOf(Date);
  });
});

describe('open registration', () => {
  let open: App;
  let db: Database;
  const signUp = (payload: object) => open.inject({ method: 'POST', url: '/auth/sign-up/email', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, payload: JSON.stringify(payload) });
  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'memory://', UPLOAD_DIR: uploadDir, REGISTRATION: 'open' });
    db = createDatabase(env.DATABASE_URL);
    await db.migrate();
    await seed(db.db, env.DEV_USER_EMAIL);
    open = await buildApp({ db: db.db, env, billing, mailer: { send: async () => undefined }, logger: false });
  });
  afterAll(async () => {
    await open.close();
    await db.close();
  });

  it('needs no code, gives Standard and keeps the acceptance of the Terms', async () => {
    const account = { name: 'Nowy', email: 'open1@example.com', password: 'Open-password-1!' };
    expect((await signUp(account)).statusCode).toBe(400);
    expect((await signUp({ ...account, acceptedTerms: true })).statusCode).toBe(200);
    const [user] = await db.db.select().from(users).where(eq(users.email, account.email));
    expect(user!.role).toBe('standard');
    expect(user!.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it('still honours a valid code and ignores an expired one', async () => {
    const admin = (await db.db.select().from(users).where(eq(users.email, 'admin@trading.local')))[0]!;
    const made = await open.inject({ method: 'POST', url: '/invites', headers: { 'x-user-id': admin.id }, payload: { role: 'pro', multiUse: false } });
    const code = made.json().code as string;
    const account = { name: 'Zaproszony', email: 'open2@example.com', password: 'Open-password-1!', acceptedTerms: true, inviteCode: code };
    expect((await signUp(account)).statusCode).toBe(200);
    expect((await db.db.select().from(users).where(eq(users.email, account.email)))[0]!.role).toBe('pro');

    const late = { ...account, email: 'open3@example.com' };
    expect((await signUp(late)).statusCode).toBe(200);
    expect((await db.db.select().from(users).where(eq(users.email, late.email)))[0]!.role).toBe('standard');
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

describe('referrals', () => {
  const DAY = 86_400_000;
  const event = (payload: object) =>
    app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': 'good' }, payload: JSON.stringify({ subscriptionId: null, ...payload }) });
  const admin = async () => (await database.db.select().from(users).where(eq(users.email, 'admin@trading.local')))[0]!;
  let code = 0;
  /** A partner and a customer referred by them who already has a Stripe customer. */
  const pair = async (percent = 30) => {
    const partner = await newUser();
    const made = `CODE${++code}`;
    const res = await app.inject({ method: 'POST', url: '/admin/partners', headers: headers((await admin()).id), payload: { email: partner.email, code: made, percent } });
    expect(res.statusCode).toBe(200);
    const customer = await newUser();
    await database.db.update(users).set({ referredBy: partner.id }).where(eq(users.id, customer.id));
    await checkout(customer.id);
    return { partner, customer, customerId: (await rowOf(customer.id)).stripeCustomerId, code: made };
  };
  let invoice = 0;
  const paid = (customerId: string, amount: number, paidAt: Date, plan = 'month', invoiceId = `in_${++invoice}`, currency = 'pln') => {
    return event({ payment: { invoiceId, customerId, amount, currency, paidAt, plan } }).then((res) => {
      expect(res.statusCode).toBe(200);
      return res;
    });
  };
  const panel = async (id: string) => (await app.inject({ url: '/referrals', headers: headers(id) })).json().partner;
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  it('gives the partner their share, once per invoice, and hides the customer', async () => {
    const { partner, customer, customerId } = await pair();
    await paid(customerId, 47200, ago(40), 'year', 'in_same');
    await paid(customerId, 47200, ago(40), 'year', 'in_same');
    await paid(customerId, 5900, ago(1), 'month');
    const view = await panel(partner.id);
    expect(view.totals).toEqual([{ currency: 'pln', ready: 141.6, waiting: 17.7, paidOut: 0 }]);
    expect(view.signups).toBe(1);
    expect(view.customers).toBe(1);
    expect(view.sales.map((s: { status: string }) => s.status)).toEqual(['waiting', 'ready']);
    expect(JSON.stringify(view)).not.toContain(customer.email!);
    expect(JSON.stringify(view)).not.toContain(customer.id);
  });

  it('counts a year from the first purchase and nothing for accounts nobody referred', async () => {
    const { partner, customerId } = await pair();
    await paid(customerId, 5900, ago(400));
    await paid(customerId, 5900, ago(380));
    await paid(customerId, 5900, ago(10));
    const view = await panel(partner.id);
    expect(view.sales).toHaveLength(2);

    const stranger = await newUser();
    await checkout(stranger.id);
    const before = (await database.db.select().from(referralCommissions)).length;
    await paid((await rowOf(stranger.id)).stripeCustomerId, 5900, ago(1));
    expect((await database.db.select().from(referralCommissions)).length).toBe(before);
  });

  it('keeps currencies apart and uses the percent in force when paid', async () => {
    const { partner, customerId } = await pair(40);
    await paid(customerId, 5900, ago(40));
    await app.inject({ method: 'PATCH', url: `/admin/partners/${partner.id}`, headers: headers((await admin()).id), payload: { percent: 10 } });
    await paid(customerId, 1500, ago(40), 'month', undefined, 'usd');
    const view = await panel(partner.id);
    expect(view.totals).toEqual(expect.arrayContaining([
      { currency: 'pln', ready: 23.6, waiting: 0, paidOut: 0 },
      { currency: 'usd', ready: 1.5, waiting: 0, paidOut: 0 },
    ]));
  });

  it('drops a refunded commission, and takes it back from the next payout once paid out', async () => {
    const { partner, customerId } = await pair();
    const adminId = (await admin()).id;
    stripe.payments.set('pi_new', 'in_new');
    await paid(customerId, 5900, ago(1), 'month', 'in_new');
    await event({ refund: { paymentIntentId: 'pi_new', refunded: 5900 } });
    await event({ refund: { paymentIntentId: 'pi_new', refunded: 5900 } });
    let view = await panel(partner.id);
    expect(view.totals[0]).toMatchObject({ waiting: 0, ready: 0 });
    expect(view.sales[0].status).toBe('refunded');

    stripe.payments.set('pi_old', 'in_old');
    await paid(customerId, 47200, ago(40), 'year', 'in_old');
    const payout = await app.inject({ method: 'POST', url: `/admin/partners/${partner.id}/payout`, headers: headers(adminId), payload: { currency: 'pln' } });
    expect(payout.json()).toEqual({ amount: 141.6, currency: 'pln' });
    expect((await panel(partner.id)).totals[0]).toMatchObject({ ready: 0, paidOut: 141.6 });
    expect((await app.inject({ method: 'POST', url: `/admin/partners/${partner.id}/payout`, headers: headers(adminId), payload: { currency: 'pln' } })).statusCode).toBe(400);

    await event({ refund: { paymentIntentId: 'pi_old', refunded: 47200 } });
    await event({ refund: { paymentIntentId: 'pi_old', refunded: 47200 } });
    view = await panel(partner.id);
    expect(view.totals[0]).toMatchObject({ ready: -141.6, paidOut: 141.6 });
    expect(view.sales.filter((s: { status: string }) => s.status === 'clawback')).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: `/admin/partners/${partner.id}/payout`, headers: headers(adminId), payload: { currency: 'pln' } })).statusCode).toBe(400);
  });

  it('shows the panel to partners only and the admin screens to admins only', async () => {
    const user = await newUser();
    expect((await app.inject({ url: '/referrals', headers: headers(user.id) })).json()).toEqual({ partner: null });
    expect((await app.inject({ url: '/admin/partners', headers: headers(user.id) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/%61dmin/partners', headers: headers(user.id) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/admin/partners', headers: headers(user.id), payload: { email: user.email, code: 'SELF' } })).statusCode).toBe(403);
  });

  it('refuses a taken code, a second record and an unknown address', async () => {
    const { partner, code: taken } = await pair();
    const adminId = (await admin()).id;
    const other = await newUser();
    const add = (email: string, value: string) => app.inject({ method: 'POST', url: '/admin/partners', headers: headers(adminId), payload: { email, code: value } });
    expect((await add(other.email!, taken)).statusCode).toBe(409);
    expect((await add(partner.email!, 'FRESH-1')).statusCode).toBe(409);
    expect((await add('nobody@example.com', 'FRESH-2')).statusCode).toBe(404);
    expect((await add(other.email!, 'x')).statusCode).toBe(400);
  });

  it('will not delete a partner who has commissions', async () => {
    const { partner, customerId } = await pair();
    await paid(customerId, 5900, ago(1));
    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${partner.id}`, headers: headers((await admin()).id) });
    expect(res.statusCode).toBe(409);
    expect((await database.db.select().from(referralPartners).where(eq(referralPartners.userId, partner.id))).length).toBe(1);
  });
});

describe('signing up through a partner', () => {
  let open: App;
  let db: Database;
  const signUp = (payload: object) => open.inject({ method: 'POST', url: '/auth/sign-up/email', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, payload: JSON.stringify({ password: 'Open-password-1!', acceptedTerms: true, name: 'Widz', ...payload }) });
  const account = async (email: string) => (await db.db.select().from(users).where(eq(users.email, email)))[0]!;
  let partner: typeof users.$inferSelect;
  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'memory://', UPLOAD_DIR: uploadDir, REGISTRATION: 'open' });
    db = createDatabase(env.DATABASE_URL);
    await db.migrate();
    await seed(db.db, env.DEV_USER_EMAIL);
    open = await buildApp({ db: db.db, env, billing, mailer: { send: async () => undefined }, logger: false });
    [partner] = (await db.db.insert(users).values({ email: 'partner@test.local', displayName: 'Partner', role: 'standard' }).returning()) as [typeof users.$inferSelect];
    await db.db.insert(referralPartners).values({ userId: partner.id, code: 'KUBA' });
  });
  afterAll(async () => {
    await open.close();
    await db.close();
  });

  it('assigns the new account, in any letter case, with the plan staying Standard', async () => {
    expect((await signUp({ email: 'viewer1@example.com', referralCode: 'kuba' })).statusCode).toBe(200);
    const user = await account('viewer1@example.com');
    expect(user.referredBy).toBe(partner.id);
    expect(user.role).toBe('standard');
  });

  it('refuses an unknown code and creates nobody', async () => {
    const res = await signUp({ email: 'viewer2@example.com', referralCode: 'NOPE' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_REFERRAL');
    expect(await account('viewer2@example.com')).toBeUndefined();
  });

  it('refuses a switched-off code but keeps earlier customers assigned', async () => {
    await db.db.update(referralPartners).set({ active: false }).where(eq(referralPartners.userId, partner.id));
    expect((await signUp({ email: 'viewer3@example.com', referralCode: 'KUBA' })).statusCode).toBe(400);
    expect((await account('viewer1@example.com')).referredBy).toBe(partner.id);
    await db.db.update(referralPartners).set({ active: true }).where(eq(referralPartners.userId, partner.id));
  });

  it('needs no code at all', async () => {
    expect((await signUp({ email: 'viewer4@example.com' })).statusCode).toBe(200);
    expect((await account('viewer4@example.com')).referredBy).toBeNull();
  });
});
