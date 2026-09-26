// Enum values shared by the database schema, API validation and clients.

export const ROLE_KEYS = ['admin', 'educator', 'user', 'vip'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_NAMES: Record<RoleKey, string> = {
  admin: 'Administrator',
  educator: 'Edukator',
  user: 'Użytkownik',
  vip: 'VIP',
};

/** Long = buy, short = sell. Signals written as BUY/SELL map onto these. */
export const DIRECTIONS = ['long', 'short'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Pips for forex and metals, ticks for futures, points for CFD indices. */
export const MEASURE_UNITS = ['pip', 'tick', 'point'] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

/** CFD positions are sized in lots, futures in contracts. */
export const MARKETS = ['cfd', 'futures'] as const;
export type Market = (typeof MARKETS)[number];

export const ASSET_CLASSES = ['forex', 'metal', 'index', 'energy', 'crypto', 'other'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const FX_RATE_SOURCES = ['auto', 'manual'] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

/** Currencies with automatic exchange rates (ECB via Frankfurter). Others need a manual rate. */
export const AUTO_FX_CURRENCIES = ['EUR', 'USD', 'GBP', 'PLN'] as const;

export const TRADE_SOURCES = ['own', 'educator'] as const;
export type TradeSource = (typeof TRADE_SOURCES)[number];

export const SIGNAL_STATUSES = ['active', 'closed', 'cancelled'] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const LEVEL_TYPES = [
  'support',
  'resistance',
  'equal_highs',
  'equal_lows',
  'swing_high',
  'swing_low',
] as const;
export type LevelType = (typeof LEVEL_TYPES)[number];

export const LEVEL_SOURCES = ['manual', 'auto'] as const;
export type LevelSource = (typeof LEVEL_SOURCES)[number];

export const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const BIASES = ['bullish', 'bearish', 'neutral'] as const;
export type Bias = (typeof BIASES)[number];

export const EVENT_IMPACTS = ['low', 'medium', 'high', 'holiday'] as const;
export type EventImpact = (typeof EVENT_IMPACTS)[number];

export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/** Currencies tracked by the economic calendar. */
export const CALENDAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'JPY'] as const;

/** Fixed emotion list, seeded into the `emotions` table. */
export const DEFAULT_EMOTIONS = [
  { key: 'calm', label: 'Spokój' },
  { key: 'confident', label: 'Pewność siebie' },
  { key: 'fear', label: 'Strach' },
  { key: 'fomo', label: 'FOMO' },
  { key: 'greed', label: 'Chciwość' },
  { key: 'impatience', label: 'Niecierpliwość' },
  { key: 'frustration', label: 'Frustracja' },
  { key: 'revenge', label: 'Chęć odegrania się' },
  { key: 'boredom', label: 'Nuda' },
  { key: 'euphoria', label: 'Euforia' },
  { key: 'doubt', label: 'Niepewność' },
] as const;

/** Items every new pre-session checklist starts with. */
export const DEFAULT_CHECKLIST_ITEMS = [
  'Zaznaczone strefy płynności z wyższych interwałów (H4/D1/W1)',
  'Określony bias dnia',
  'Sprawdzone kluczowe newsy i dane makro',
  'Ustalone maksymalne ryzyko na dzień',
  'Plan wejścia i miejsce unieważnienia scenariusza',
] as const;
