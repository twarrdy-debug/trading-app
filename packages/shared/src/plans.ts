import type { RoleKey } from './enums.ts';

/**
 * What each role may use (owner's plans, 2026-10-20). Pro and VIP have everything (VIP is the same
 * as Pro for now), and so does an admin. Standard has the dashboard, the journal and trades (at most
 * STANDARD_TRADE_LIMIT trades in all), statistics, strategies, the plain calculator and the calendar,
 * on one trading account. The educator role is withdrawn for now; its users became Pro.
 */
export const FEATURES = ['analysis', 'backtest', 'news', 'calculatorPro', 'multipleAccounts', 'unlimitedTrades', 'apiKeys'] as const;
export type Feature = (typeof FEATURES)[number];

/** Trades a Standard account may keep in the journal; more need Pro or VIP. */
export const STANDARD_TRADE_LIMIT = 5;

const FULL: readonly RoleKey[] = ['admin', 'pro', 'vip', 'educator'];

export const hasFeature = (role: RoleKey, feature: Feature) => FULL.includes(role) || !FEATURES.includes(feature);
export const featuresOf = (role: RoleKey): Feature[] => FEATURES.filter((f) => hasFeature(role, f));

/** Roles an admin can give (the educator role is withdrawn). */
export const ASSIGNABLE_ROLES = ['standard', 'pro', 'vip', 'admin'] as const;
/** Roles an invitation can give. */
export const INVITE_ROLES = ['standard', 'pro', 'vip'] as const;

/**
 * API keys (a trading bot): the plan must have them and an admin must have turned them on for the
 * user (`users.api_access`); an admin always may.
 */
export const apiAllowed = (user: { role: RoleKey; apiAccess: boolean }) => hasFeature(user.role, 'apiKeys') && (user.role === 'admin' || user.apiAccess);

/** How a paid Pro plan renews. */
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const BILLING_CURRENCIES = ['usd', 'pln'] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

/**
 * Pro's prices (owner, 2026-11-03): 15 USD a month, 120 USD a year, and the first FOUNDER_SEATS
 * buyers who type the code FOUNDER_CODE on Stripe's page get their first year for 15 USD. Stripe charges what `npm run stripe:setup` created there;
 * keep the two in step. The zloty prices exist because BLIK only takes PLN.
 */
export const PRO_PRICES: Record<BillingCurrency, Record<BillingInterval | 'founderYear', number>> = {
  usd: { month: 15, year: 120, founderYear: 15 },
  pln: { month: 59, year: 472, founderYear: 59 },
};
export const FOUNDER_SEATS = 50;
export const FOUNDER_CODE = 'FOUNDERS';
/** Off the first year's price, so 120 USD becomes 15 USD and 472 zl becomes 59 zl. */
export const FOUNDER_PERCENT_OFF = 87.5;

/** A subscription in these Stripe states gives Pro; `past_due` keeps it while Stripe retries the card. */
export const subscriptionGivesPro = (status: string | null | undefined) => status === 'active' || status === 'trialing' || status === 'past_due';

/** Referrals (owner's rules): a share of what a referred customer pays, for a year from the first purchase. */
export const REFERRAL_DEFAULT_PERCENT = 30;
export const REFERRAL_MONTHS = 12;
/** A commission waits this long: the customer's 14 days of withdrawal and room for refunds. */
export const REFERRAL_HOLD_DAYS = 30;
export const REFERRAL_STATUSES = ['waiting', 'ready', 'paidOut', 'refunded', 'clawback'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export type ReferralPlan = 'month' | 'year' | 'founder';
export const normalizeReferralCode = (code: string) => code.trim().toUpperCase();
