// Request schemas shared by the API (validation) and clients (forms).
import { z } from 'zod';
import {
  ACCENT_COLORS,
  ACCOUNT_TYPES,
  ASSET_CLASSES,
  DRAWDOWN_TYPES,
  LEVERAGE_OPTIONS,
  LOSS_ALERT_MODES,
  BIASES,
  DIRECTIONS,
  EVENT_CATEGORIES,
  EVENT_IMPACTS,
  LANGUAGES,
  NEWS_CATEGORIES,
  LEVEL_TYPES,
  MARKETS,
  MEASURE_UNITS,
  SIGNAL_STATUSES,
  THEMES,
  TIMEFRAMES,
  TRADE_SOURCES,
} from './enums.ts';
import { BROKER_TIMEZONES } from './dates.ts';

/**
 * Custom validation messages are message keys; the API translates them into the user's
 * language (apps/api/src/i18n.ts).
 */
export const VALIDATION_KEYS = [
  'validation.currencyCode',
  'validation.accent',
  'validation.timezone',
  'validation.educatorOrSignal',
  'validation.leverage',
  'validation.propMarket',
  'validation.propDrawdown',
] as const;

const price = z.number().positive();
const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'validation.currencyCode')
  .transform((c) => c.toUpperCase());

export const idParams = z.object({ id: z.uuid() });

// --- User settings -----------------------------------------------------------

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const updateSettingsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    accountCurrency: currency,
    theme: z.enum(THEMES),
    /** One of ACCENT_COLORS (orange or monochrome). */
    accentColor: z
      .string()
      .transform((c) => c.toUpperCase())
      .refine((c) => (Object.values(ACCENT_COLORS) as string[]).includes(c), 'validation.accent')
      .nullable(),
    timezone: z.string().refine(isValidTimeZone, 'validation.timezone'),
    language: z.enum(LANGUAGES),
    maxTradesPerDay: z.number().int().min(1).max(100).nullable(),
    /** Losing trades in a row today that trigger the overtrading warning. */
    lossStreakAlert: z.number().int().min(1).max(20),
    /** Count losses in a row (default) or all losing trades of the day. */
    lossAlertMode: z.enum(LOSS_ALERT_MODES),
    /** Words that highlight a headline in the news feed and raise an alert (sound, notification). */
    newsKeywords: z
      .array(z.string().trim().min(2).max(40))
      .max(30)
      // Duplicates differing only in case are dropped; the first spelling stays.
      .transform((words) => words.filter((w, i) => words.findIndex((o) => o.toLowerCase() === w.toLowerCase()) === i)),
  })
  .partial();

// --- Invitations -------------------------------------------------------------

/** Admin: an invitation for invite-only registration. */
export const createInviteSchema = z.object({
  /** Only this address can use it; any address when omitted. */
  email: z.email().optional(),
  role: z.enum(['user', 'vip', 'educator']).default('user'),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

// --- Trading accounts --------------------------------------------------------

const accountFields = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(ACCOUNT_TYPES),
  /** What the account trades. Required for prop accounts: the trade form then offers only that market. */
  market: z.enum(MARKETS).nullable().optional(),
  /** Starting balance in the user's account currency. */
  size: z.number().positive().max(1_000_000_000),
  /** Prop firm maximum drawdown, % of the starting balance (static). Required for prop accounts. */
  maxDrawdownPct: z.number().min(0.1).max(100).nullable().optional(),
  /** Prop: static floor or end-of-day trailing floor (default static). */
  drawdownType: z.enum(DRAWDOWN_TYPES).optional(),
  /** Prop firm profit target, % of the starting balance. */
  profitTargetPct: z.number().min(0.1).max(1000).nullable().optional(),
  /** CFD leverage (1:n), used to show the margin of a position. */
  leverage: z
    .number()
    .int()
    .refine((v) => (LEVERAGE_OPTIONS as readonly number[]).includes(v), 'validation.leverage')
    .nullable()
    .optional(),
});

/** Prop accounts need a market and a maximum drawdown. */
const propRules = (a: Partial<z.infer<typeof accountFields>>, ctx: z.RefinementCtx) => {
  if (a.type !== 'prop') return;
  if (!a.market) ctx.addIssue({ code: 'custom', path: ['market'], message: 'validation.propMarket' });
  if (a.maxDrawdownPct == null) ctx.addIssue({ code: 'custom', path: ['maxDrawdownPct'], message: 'validation.propDrawdown' });
};

export const createAccountSchema = accountFields.superRefine(propRules);
/** Partial; the API checks the prop rules on the account as it will be after the change. */
export const updateAccountSchema = accountFields.partial();

/** Which trades to show: one account (uuid), trades without an account (`none`), or all when omitted. */
const accountFilter = z.union([z.uuid(), z.literal('none')]).optional();

// --- Instruments & educators -------------------------------------------------

export const createInstrumentSchema = z.object({
  symbol: z.string().trim().min(1).max(20).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1).max(80),
  market: z.enum(MARKETS),
  assetClass: z.enum(ASSET_CLASSES),
  measureUnit: z.enum(MEASURE_UNITS),
  unitSize: z.number().positive(),
  unitValue: z.number().positive(),
  quoteCurrency: currency,
  currencies: z.array(currency).max(5).default([]),
});

export const createEducatorSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.email().optional(),
});

// --- Trades ------------------------------------------------------------------

const tradeFields = z.object({
  instrumentId: z.uuid(),
  direction: z.enum(DIRECTIONS),
  openedAt: isoDateTime,
  closedAt: isoDateTime.nullable().optional(),
  entryPrice: price,
  exitPrice: price.nullable().optional(),
  stopLoss: price.nullable().optional(),
  takeProfit: price.nullable().optional(),
  positionSize: z.number().positive(),
  fees: z.number().min(0).nullable().optional(),
  /**
   * Quote -> account currency rate. Omit (or send null) to fill it automatically:
   * 1 for the same currency, the ECB rate for EUR/USD/GBP/PLN.
   */
  fxRate: z.number().positive().nullable().optional(),
  /** Spread in pips/points; defaults to the spread saved for that instrument and day. */
  spread: z.number().min(0).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  source: z.enum(TRADE_SOURCES).default('own'),
  educatorId: z.uuid().nullable().optional(),
  signalId: z.uuid().nullable().optional(),
  /** Trading account the trade belongs to (null = none). */
  accountId: z.uuid().nullable().optional(),
  emotionKeys: z.array(z.string()).max(20).default([]),
});

export const createTradeSchema = tradeFields.superRefine((t, ctx) => {
  if (t.source === 'educator' && !t.educatorId && !t.signalId) {
    ctx.addIssue({ code: 'custom', path: ['educatorId'], message: 'validation.educatorOrSignal' });
  }
});

export const updateTradeSchema = tradeFields.partial();

export const tradeFiltersSchema = z.object({
  account: accountFilter,
  instrumentId: z.uuid().optional(),
  direction: z.enum(DIRECTIONS).optional(),
  source: z.enum(TRADE_SOURCES).optional(),
  status: z.enum(['open', 'closed']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  sizeMin: z.coerce.number().optional(),
  sizeMax: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const tradeStatsQuerySchema = z.object({
  account: accountFilter,
  instrumentId: z.uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

// --- Import from trading platforms ----------------------------------------

/**
 * Text fields sent next to the report file (multipart). `symbolMap` maps broker symbols the app
 * could not match (e.g. "GER40.cash") to instruments; `commit=false` only previews.
 */
export const mt5ImportFieldsSchema = z.object({
  /** Imported trades are assigned to this account. */
  accountId: z.uuid().optional(),
  timezone: z.enum(BROKER_TIMEZONES).default('broker-ny7'),
  symbolMap: z
    .string()
    .default('{}')
    .transform((text, ctx) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'symbolMap: JSON' });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string(), z.uuid())),
  commit: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Mt5ImportFields = z.infer<typeof mt5ImportFieldsSchema>;

// --- Signals -----------------------------------------------------------------

export const createSignalSchema = z.object({
  instrumentId: z.uuid(),
  direction: z.enum(DIRECTIONS),
  entryPrice: price,
  stopLoss: price,
  takeProfits: z.array(price).min(1).max(10),
  notes: z.string().max(5_000).nullable().optional(),
  /** Admins may post on behalf of an educator; educators always post as themselves. */
  educatorId: z.uuid().optional(),
  publishedAt: isoDateTime.optional(),
});

export const updateSignalSchema = z.object({
  status: z.enum(SIGNAL_STATUSES).optional(),
  notes: z.string().max(5_000).nullable().optional(),
});

export const parseSignalSchema = z.object({ text: z.string().min(1).max(2_000) });

export const signalFiltersSchema = z.object({
  instrumentId: z.uuid().optional(),
  educatorId: z.uuid().optional(),
  status: z.enum(SIGNAL_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// --- Daily analysis ----------------------------------------------------------

export const createLevelSchema = z.object({
  instrumentId: z.uuid(),
  price,
  type: z.enum(LEVEL_TYPES),
  timeframe: z.enum(TIMEFRAMES),
  note: z.string().max(2_000).nullable().optional(),
  validFrom: isoDate.optional(),
  validUntil: isoDate.nullable().optional(),
});

export const updateLevelSchema = createLevelSchema.omit({ instrumentId: true }).partial();

export const levelFiltersSchema = z.object({
  instrumentId: z.uuid(),
  /** Levels valid on this day; defaults to today. */
  date: isoDate.optional(),
  timeframe: z.enum(TIMEFRAMES).optional(),
});

// --- Strategies ----------------------------------------------------------------

export const MAX_STRATEGY_RULES = 30;
const strategyName = z.string().trim().min(1).max(80);
const ruleLabel = z.string().trim().min(1).max(200);

export const createStrategySchema = z.object({
  name: strategyName,
  description: z.string().trim().max(2000).nullish(),
  /** Initial rules, in order. */
  rules: z.array(ruleLabel).max(MAX_STRATEGY_RULES).default([]),
});
export const updateStrategySchema = z.object({ name: strategyName, description: z.string().trim().max(2000).nullable() }).partial();
export const addStrategyRuleSchema = z.object({ label: ruleLabel });
export const updateStrategyRuleSchema = z.object({ label: ruleLabel });
/** The strategy's rule ids in their new order (all of them). */
export const reorderStrategyRulesSchema = z.object({ ids: z.array(z.uuid()).max(MAX_STRATEGY_RULES) });
export const strategyRuleParams = z.object({ id: z.uuid(), ruleId: z.uuid() });

export const checklistParams = z.object({ instrumentId: z.uuid(), date: isoDate });

/** Daily spread per instrument (pips/points), same URL shape as checklists. */
export const spreadParams = checklistParams;
export const setSpreadSchema = z.object({ spread: z.number().min(0) });

export const updateChecklistSchema = z
  .object({
    bias: z.enum(BIASES).nullable(),
    biasNote: z.string().max(5_000).nullable(),
    htfNotes: z.string().max(5_000).nullable(),
    newsNotes: z.string().max(5_000).nullable(),
  })
  .partial();

export const addChecklistItemSchema = z.object({ label: z.string().trim().min(1).max(200) });
export const updateChecklistItemSchema = z
  .object({ label: z.string().trim().min(1).max(200), checked: z.boolean() })
  .partial();

// --- Economic calendar -------------------------------------------------------

/** Comma-separated list in a query string, e.g. "USD,EUR". */
const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();

export const calendarQuerySchema = z.object({
  /** Local calendar days (user time zone), inclusive. */
  from: isoDate,
  to: isoDate,
  currencies: z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean))
    .optional(),
  impacts: csv(EVENT_IMPACTS),
  categories: csv(EVENT_CATEGORIES),
  instrumentId: z.uuid().optional(),
});

export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

// --- News ----------------------------------------------------------------------

export const newsQuerySchema = z.object({
  /** Cursor from the previous page (`nextCursor`): older headlines only. */
  before: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
  categories: csv(NEWS_CATEGORIES),
  currencies: z
    .string()
    .transform((s) => s.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean))
    .optional(),
  /** Headlines about the instrument's currencies or its market (gold, oil, indices). */
  instrumentId: z.uuid().optional(),
  /** Text search in the headline. */
  q: z.string().trim().max(100).optional(),
  /** Only headlines FinancialJuice marked red. */
  important: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Include paywalled and image-only posts (hidden by default). */
  noise: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type NewsQuery = z.infer<typeof newsQuerySchema>;

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateInstrumentInput = z.infer<typeof createInstrumentSchema>;
export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type CreateStrategyInput = z.input<typeof createStrategySchema>;
export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;
export type TradeFilters = z.infer<typeof tradeFiltersSchema>;
export type CreateSignalInput = z.infer<typeof createSignalSchema>;
export type CreateLevelInput = z.infer<typeof createLevelSchema>;
