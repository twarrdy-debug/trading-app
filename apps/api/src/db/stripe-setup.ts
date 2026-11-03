// Creates what the app sells in the Stripe account of STRIPE_SECRET_KEY; safe to run again.
//   npm run stripe:setup            (refuses a live key)
//   npm run stripe:setup -- --live  (only when going live on purpose)
import { FOUNDER_CODE, FOUNDER_PERCENT_OFF, FOUNDER_SEATS, PRO_PRICES, type BillingInterval } from '@trading/shared';
import Stripe from 'stripe';
import { FOUNDER_COUPON, PRICE_KEYS } from '../services/billing.ts';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY in apps/api/.env first.');
  process.exit(1);
}
if (/^(sk|rk)_live/.test(key) && !process.argv.includes('--live')) {
  console.error('This is a live key. Add --live only if you mean to create the real prices.');
  process.exit(1);
}
const stripe = new Stripe(key);
const cents = (amount: number) => Math.round(amount * 100);

const products = await stripe.products.search({ query: "metadata['app']:'alphalogfx-pro'" });
const product = products.data[0] ?? (await stripe.products.create({ name: 'AlphaLogFX Pro', metadata: { app: 'alphalogfx-pro' } }));
console.log(`Product: ${product.name}`);

for (const interval of ['month', 'year'] as BillingInterval[]) {
  const lookup = PRICE_KEYS[interval];
  const existing = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (existing.data[0]) {
    console.log(`Price ${lookup}: already there (a change of price needs a new one in Stripe)`);
    continue;
  }
  await stripe.prices.create({
    product: product.id,
    lookup_key: lookup,
    currency: 'usd',
    unit_amount: cents(PRO_PRICES.usd[interval]),
    currency_options: { pln: { unit_amount: cents(PRO_PRICES.pln[interval]) } },
    recurring: { interval },
  });
  console.log(`Price ${lookup}: ${PRO_PRICES.usd[interval]} USD / ${PRO_PRICES.pln[interval]} PLN`);
}

const coupon = await stripe.coupons.retrieve(FOUNDER_COUPON).catch(() => null);
if (coupon) {
  console.log(`Coupon ${FOUNDER_COUPON}: already there, ${coupon.times_redeemed} of ${coupon.max_redemptions} used`);
} else {
  await stripe.coupons.create({
    id: FOUNDER_COUPON,
    name: 'FOUNDERS',
    percent_off: FOUNDER_PERCENT_OFF,
    duration: 'once',
    max_redemptions: FOUNDER_SEATS,
    applies_to: { products: [product.id] },
  });
  console.log(`Coupon ${FOUNDER_COUPON}: ${FOUNDER_PERCENT_OFF}% off the first year, ${FOUNDER_SEATS} uses`);
}

// What the buyer types. The minimum keeps it off the monthly plan, whose price is under it; `first
// time` keeps it to one use per buyer. The coupon's percentage would otherwise fit any price.
const codes = await stripe.promotionCodes.list({ code: FOUNDER_CODE, limit: 1 });
if (codes.data[0]) {
  console.log(`Code ${FOUNDER_CODE}: already there, ${codes.data[0].times_redeemed} used`);
} else {
  await stripe.promotionCodes.create({
    promotion: { type: 'coupon', coupon: FOUNDER_COUPON },
    code: FOUNDER_CODE,
    max_redemptions: FOUNDER_SEATS,
    restrictions: {
      first_time_transaction: true,
      minimum_amount: cents(PRO_PRICES.usd.year),
      minimum_amount_currency: 'usd',
      currency_options: { pln: { minimum_amount: cents(PRO_PRICES.pln.year) } },
    },
  });
  console.log(`Code ${FOUNDER_CODE}: yearly plan only, first-time buyers, ${FOUNDER_SEATS} uses`);
}

const portals = await stripe.billingPortal.configurations.list({ active: true, limit: 1 });
if (portals.data[0]) {
  console.log('Customer portal: already configured');
} else {
  await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'AlphaLogFX' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
    },
  });
  console.log('Customer portal: configured');
}
console.log('Done. The webhook goes to <address>/api/billing/webhook; its secret is STRIPE_WEBHOOK_SECRET.');
