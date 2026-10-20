import type { RoleKey } from './enums.ts';

/**
 * What each role may use (owner's plans, 2026-10-20). Pro and VIP have everything (VIP is the same
 * as Pro for now), and so does an admin. Standard has the dashboard, the journal and trades (at most
 * STANDARD_TRADE_LIMIT trades in all), statistics, strategies, the plain calculator and the calendar,
 * on one trading account. The educator role is withdrawn for now; its users became Pro.
 */
export const FEATURES = ['analysis', 'backtest', 'news', 'calculatorPro', 'multipleAccounts', 'unlimitedTrades'] as const;
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
