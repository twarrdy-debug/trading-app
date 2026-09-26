import {
  ASSET_CLASSES,
  BIASES,
  DIRECTIONS,
  EVENT_CATEGORIES,
  EVENT_IMPACTS,
  FX_RATE_SOURCES,
  LEVEL_SOURCES,
  LEVEL_TYPES,
  MARKETS,
  MEASURE_UNITS,
  ROLE_KEYS,
  SIGNAL_STATUSES,
  THEMES,
  TIMEFRAMES,
  TRADE_SOURCES,
} from '@trading/shared';
import { relations } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleKey = pgEnum('role_key', ROLE_KEYS);
export const direction = pgEnum('direction', DIRECTIONS);
export const measureUnit = pgEnum('measure_unit', MEASURE_UNITS);
export const market = pgEnum('market', MARKETS);
export const fxRateSource = pgEnum('fx_rate_source', FX_RATE_SOURCES);
export const assetClass = pgEnum('asset_class', ASSET_CLASSES);
export const tradeSource = pgEnum('trade_source', TRADE_SOURCES);
export const signalStatus = pgEnum('signal_status', SIGNAL_STATUSES);
export const levelType = pgEnum('level_type', LEVEL_TYPES);
export const levelSource = pgEnum('level_source', LEVEL_SOURCES);
export const timeframe = pgEnum('timeframe', TIMEFRAMES);
export const bias = pgEnum('bias', BIASES);
export const eventImpact = pgEnum('event_impact', EVENT_IMPACTS);
export const eventCategory = pgEnum('event_category', EVENT_CATEGORIES);
export const theme = pgEnum('theme', THEMES);

// Prices and money are exact decimals, read back as JS numbers.
const priceCol = (name: string) => numeric(name, { precision: 18, scale: 6, mode: 'number' });
const moneyCol = (name: string) => numeric(name, { precision: 18, scale: 2, mode: 'number' });

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// --- Users & roles -----------------------------------------------------------

/** Permissions per role will be defined in a later stage. */
export const roles = pgTable('roles', {
  key: roleKey('key').primaryKey(),
  name: text('name').notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  displayName: text('display_name').notNull(),
  role: roleKey('role').notNull().default('user').references(() => roles.key),
  accountCurrency: char('account_currency', { length: 3 }).notNull().default('USD'),
  theme: theme('theme').notNull().default('dark'),
  accentColor: text('accent_color'),
  timezone: text('timezone').notNull().default('Europe/Warsaw'),
  maxTradesPerDay: smallint('max_trades_per_day'),
  ...timestamps,
});

// --- Instruments -------------------------------------------------------------

export const instruments = pgTable('instruments', {
  id: uuid('id').primaryKey().defaultRandom(),
  symbol: text('symbol').notNull().unique(),
  name: text('name').notNull(),
  market: market('market').notNull(),
  assetClass: assetClass('asset_class').notNull(),
  measureUnit: measureUnit('measure_unit').notNull(),
  /** Price move of one pip/tick/point. */
  unitSize: numeric('unit_size', { precision: 18, scale: 8, mode: 'number' }).notNull(),
  /** Value of one unit per lot (CFD) or contract (futures), in the quote currency. */
  unitValue: numeric('unit_value', { precision: 18, scale: 6, mode: 'number' }).notNull(),
  quoteCurrency: char('quote_currency', { length: 3 }).notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

/** Currencies whose economic events move the instrument (calendar mapping). */
export const instrumentCurrencies = pgTable(
  'instrument_currencies',
  {
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    currency: char('currency', { length: 3 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.currency] })],
);

// --- Signals -----------------------------------------------------------------

export const signals = pgTable(
  'signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    educatorId: uuid('educator_id')
      .notNull()
      .references(() => users.id),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    direction: direction('direction').notNull(),
    entryPrice: priceCol('entry_price').notNull(),
    stopLoss: priceCol('stop_loss').notNull(),
    notes: text('notes'),
    status: signalStatus('status').notNull().default('active'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('signals_published_idx').on(t.publishedAt)],
);

export const signalTakeProfits = pgTable(
  'signal_take_profits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    /** 1 for TP1, 2 for TP2, ... */
    level: smallint('level').notNull(),
    price: priceCol('price').notNull(),
    hitAt: timestamp('hit_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('signal_tp_level_idx').on(t.signalId, t.level)],
);

// --- Trading journal ---------------------------------------------------------

export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    direction: direction('direction').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Day of `openedAt` in the user's time zone; the daily number (1/26.09.2025) is derived from it. */
    tradeDate: date('trade_date').notNull(),
    entryPrice: priceCol('entry_price').notNull(),
    exitPrice: priceCol('exit_price'),
    stopLoss: priceCol('stop_loss'),
    takeProfit: priceCol('take_profit'),
    positionSize: numeric('position_size', { precision: 18, scale: 4, mode: 'number' }).notNull(),
    fees: moneyCol('fees'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8, mode: 'number' }),
    /** `manual` rates are kept on edits; `auto` rates are fetched again when dates change. */
    fxRateSource: fxRateSource('fx_rate_source'),
    /** Spread in pips/points, copied from the daily spread unless entered on the trade. */
    spreadUnits: numeric('spread_units', { precision: 12, scale: 2, mode: 'number' }),
    // Derived from the fields above by computeTradeMetrics(); stored for filtering and stats.
    resultUnits: numeric('result_units', { precision: 18, scale: 2, mode: 'number' }),
    pnlQuote: moneyCol('pnl_quote'),
    pnlAccount: moneyCol('pnl_account'),
    accountCurrency: char('account_currency', { length: 3 }).notNull(),
    riskUnits: numeric('risk_units', { precision: 18, scale: 2, mode: 'number' }),
    rMultiple: numeric('r_multiple', { precision: 10, scale: 2, mode: 'number' }),
    plannedRR: numeric('planned_rr', { precision: 10, scale: 2, mode: 'number' }),
    spreadCost: moneyCol('spread_cost'),
    notes: text('notes'),
    source: tradeSource('source').notNull().default('own'),
    educatorId: uuid('educator_id').references(() => users.id),
    signalId: uuid('signal_id').references(() => signals.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('trades_user_date_idx').on(t.userId, t.tradeDate, t.openedAt),
    index('trades_user_instrument_idx').on(t.userId, t.instrumentId),
  ],
);

export const emotions = pgTable('emotions', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  sortOrder: smallint('sort_order').notNull().default(0),
});

export const tradeEmotions = pgTable(
  'trade_emotions',
  {
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    emotionKey: text('emotion_key')
      .notNull()
      .references(() => emotions.key),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.emotionKey] })],
);

export const tradeScreenshots = pgTable('trade_screenshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tradeId: uuid('trade_id')
    .notNull()
    .references(() => trades.id, { onDelete: 'cascade' }),
  /** Key in file storage (local disk now, S3/R2 later). */
  storageKey: text('storage_key').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Spread the user saw on an instrument on a given day (CFD), suggested for new trades. */
export const dailySpreads = pgTable(
  'daily_spreads',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    spreadUnits: numeric('spread_units', { precision: 12, scale: 2, mode: 'number' }).notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.instrumentId, t.date] })],
);

/** Cached daily ECB exchange rates. `date` is the requested day, `rateDate` the ECB publication day. */
export const fxRates = pgTable(
  'fx_rates',
  {
    date: date('date').notNull(),
    base: char('base', { length: 3 }).notNull(),
    quote: char('quote', { length: 3 }).notNull(),
    rate: numeric('rate', { precision: 18, scale: 8, mode: 'number' }).notNull(),
    rateDate: date('rate_date').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.date, t.base, t.quote] })],
);

/**
 * Measured difference between a CFD's reference price and its futures, per pair
 * (CFD_FUTURES_PAIRS). `live` means both quotes were current and taken within minutes
 * of each other; outside market hours the cash index is frozen, so such snapshots are
 * shown with a warning and never used for alerts.
 */
export const basisSnapshots = pgTable(
  'basis_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pairKey: text('pair_key').notNull(),
    cfdPrice: priceCol('cfd_price').notNull(),
    futuresPrice: priceCol('futures_price').notNull(),
    difference: priceCol('difference').notNull(),
    cfdQuotedAt: timestamp('cfd_quoted_at', { withTimezone: true }).notNull(),
    futuresQuotedAt: timestamp('futures_quoted_at', { withTimezone: true }).notNull(),
    live: boolean('live').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('basis_pair_measured_idx').on(t.pairKey, t.measuredAt)],
);

// --- Daily analysis ----------------------------------------------------------

export const liquidityLevels = pgTable(
  'liquidity_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    price: priceCol('price').notNull(),
    type: levelType('type').notNull(),
    timeframe: timeframe('timeframe').notNull(),
    source: levelSource('source').notNull().default('manual'),
    note: text('note'),
    validFrom: date('valid_from').notNull(),
    /** Null while the level is still in play. */
    validUntil: date('valid_until'),
    ...timestamps,
  },
  (t) => [index('levels_user_instrument_idx').on(t.userId, t.instrumentId, t.validFrom)],
);

export const sessionChecklists = pgTable(
  'session_checklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    date: date('date').notNull(),
    bias: bias('bias'),
    biasNote: text('bias_note'),
    htfNotes: text('htf_notes'),
    newsNotes: text('news_notes'),
    ...timestamps,
  },
  (t) => [uniqueIndex('checklist_user_instrument_date_idx').on(t.userId, t.instrumentId, t.date)],
);

export const checklistItems = pgTable('checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  checklistId: uuid('checklist_id')
    .notNull()
    .references(() => sessionChecklists.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  checked: boolean('checked').notNull().default(false),
  sortOrder: smallint('sort_order').notNull().default(0),
});

/** Price history imported from CSV (TradingView/MT5), used for swing and equal high/low detection. */
export const ohlcCandles = pgTable(
  'ohlc_candles',
  {
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    timeframe: timeframe('timeframe').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    open: priceCol('open').notNull(),
    high: priceCol('high').notNull(),
    low: priceCol('low').notNull(),
    close: priceCol('close').notNull(),
    volume: numeric('volume', { precision: 20, scale: 4, mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.instrumentId, t.timeframe, t.ts] })],
);

// --- Economic calendar -------------------------------------------------------

export const economicEvents = pgTable(
  'economic_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull().default('forexfactory'),
    /** Stable key from the source feed, used to upsert on refresh. */
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    impact: eventImpact('impact').notNull(),
    /** Derived from the title by categorizeEvent(); Forex Factory has no event type. */
    category: eventCategory('category').notNull().default('other'),
    eventTime: timestamp('event_time', { withTimezone: true }).notNull(),
    forecast: text('forecast'),
    previous: text('previous'),
    actual: text('actual'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('events_source_external_idx').on(t.source, t.externalId),
    index('events_time_idx').on(t.eventTime),
  ],
);

// --- Relations (for relational queries) ---------------------------------------

export const instrumentsRelations = relations(instruments, ({ many }) => ({
  currencies: many(instrumentCurrencies),
}));

export const instrumentCurrenciesRelations = relations(instrumentCurrencies, ({ one }) => ({
  instrument: one(instruments, { fields: [instrumentCurrencies.instrumentId], references: [instruments.id] }),
}));

export const signalsRelations = relations(signals, ({ one, many }) => ({
  educator: one(users, { fields: [signals.educatorId], references: [users.id] }),
  instrument: one(instruments, { fields: [signals.instrumentId], references: [instruments.id] }),
  takeProfits: many(signalTakeProfits),
}));

export const signalTakeProfitsRelations = relations(signalTakeProfits, ({ one }) => ({
  signal: one(signals, { fields: [signalTakeProfits.signalId], references: [signals.id] }),
}));

export const tradesRelations = relations(trades, ({ one, many }) => ({
  instrument: one(instruments, { fields: [trades.instrumentId], references: [instruments.id] }),
  educator: one(users, { fields: [trades.educatorId], references: [users.id] }),
  signal: one(signals, { fields: [trades.signalId], references: [signals.id] }),
  emotions: many(tradeEmotions),
  screenshots: many(tradeScreenshots),
}));

export const tradeEmotionsRelations = relations(tradeEmotions, ({ one }) => ({
  trade: one(trades, { fields: [tradeEmotions.tradeId], references: [trades.id] }),
  emotion: one(emotions, { fields: [tradeEmotions.emotionKey], references: [emotions.key] }),
}));

export const tradeScreenshotsRelations = relations(tradeScreenshots, ({ one }) => ({
  trade: one(trades, { fields: [tradeScreenshots.tradeId], references: [trades.id] }),
}));

export const sessionChecklistsRelations = relations(sessionChecklists, ({ many }) => ({
  items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  checklist: one(sessionChecklists, { fields: [checklistItems.checklistId], references: [sessionChecklists.id] }),
}));
