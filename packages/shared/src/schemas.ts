// Request schemas shared by the API (validation) and clients (forms).
import { z } from 'zod';
import {
  ASSET_CLASSES,
  BIASES,
  DIRECTIONS,
  LEVEL_TYPES,
  MARKETS,
  MEASURE_UNITS,
  SIGNAL_STATUSES,
  THEMES,
  TIMEFRAMES,
  TRADE_SOURCES,
} from './enums.ts';

const price = z.number().positive();
const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'Kod waluty musi mieć 3 litery, np. USD')
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
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Kolor w formacie #RRGGBB').nullable(),
    timezone: z.string().refine(isValidTimeZone, 'Nieznana strefa czasowa'),
    maxTradesPerDay: z.number().int().min(1).max(100).nullable(),
  })
  .partial();

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
  emotionKeys: z.array(z.string()).max(20).default([]),
});

export const createTradeSchema = tradeFields.superRefine((t, ctx) => {
  if (t.source === 'educator' && !t.educatorId && !t.signalId) {
    ctx.addIssue({ code: 'custom', path: ['educatorId'], message: 'Wybierz edukatora lub sygnał' });
  }
});

export const updateTradeSchema = tradeFields.partial();

export const tradeFiltersSchema = z.object({
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
  instrumentId: z.uuid().optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

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

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateInstrumentInput = z.infer<typeof createInstrumentSchema>;
export type CreateTradeInput = z.infer<typeof createTradeSchema>;
export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;
export type TradeFilters = z.infer<typeof tradeFiltersSchema>;
export type CreateSignalInput = z.infer<typeof createSignalSchema>;
export type CreateLevelInput = z.infer<typeof createLevelSchema>;
