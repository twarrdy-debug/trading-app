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

/** Optional trading account profile: a live account or a prop firm account (challenge / funded). */
export const ACCOUNT_TYPES = ['live', 'prop'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * How a prop account's maximum drawdown floor moves: `static` stays at size − limit; `eod` trails
 * the highest end-of-day balance (minus the limit) and stops once it reaches the starting size.
 */
export const DRAWDOWN_TYPES = ['static', 'eod'] as const;
export type DrawdownType = (typeof DRAWDOWN_TYPES)[number];

/** CFD leverage a user can pick in the settings (1:10 … 1:1000), used to show the margin. */
export const LEVERAGE_OPTIONS = [10, 20, 30, 40, 50, 100, 500, 1000] as const;
export type Leverage = (typeof LEVERAGE_OPTIONS)[number];

/** App languages: user-facing strings in the clients and API messages. */
export const LANGUAGES = ['pl', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Currencies shown by default in the economic calendar. */
export const CALENDAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'JPY'] as const;

export const EVENT_IMPACT_LABELS: Record<Language, Record<EventImpact, string>> = {
  pl: { high: 'Wysoki', medium: 'Średni', low: 'Niski', holiday: 'Święto' },
  en: { high: 'High', medium: 'Medium', low: 'Low', holiday: 'Holiday' },
};

export const EVENT_CATEGORIES = [
  'central_bank',
  'inflation',
  'labor',
  'growth',
  'business',
  'consumer',
  'housing',
  'trade',
  'energy',
  'bonds',
  'holiday',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_CATEGORY_LABELS: Record<Language, Record<EventCategory, string>> = {
  pl: {
    central_bank: 'Banki centralne',
    inflation: 'Inflacja',
    labor: 'Rynek pracy',
    growth: 'PKB i wzrost',
    business: 'Koniunktura (PMI)',
    consumer: 'Konsumpcja',
    housing: 'Nieruchomości',
    trade: 'Handel',
    energy: 'Surowce i energia',
    bonds: 'Obligacje',
    holiday: 'Święto',
    other: 'Inne',
  },
  en: {
    central_bank: 'Central banks',
    inflation: 'Inflation',
    labor: 'Labour market',
    growth: 'GDP & growth',
    business: 'Business (PMI)',
    consumer: 'Consumer',
    housing: 'Housing',
    trade: 'Trade',
    energy: 'Commodities & energy',
    bonds: 'Bonds',
    holiday: 'Holiday',
    other: 'Other',
  },
};

/** Kinds of news headlines, derived from the title by parseNewsTitle() (shared/news.ts). */
/**
 * The two accent colours a user can pick: orange (default) and monochrome, stored as white and drawn
 * as black details on the light theme and white ones on the dark theme (apps/web lib/theme.ts).
 */
export const ACCENT_COLORS = { orange: '#FFB020', mono: '#FFFFFF' } as const;
export type AccentKey = keyof typeof ACCENT_COLORS;

export const NEWS_CATEGORIES = ['data', 'central_bank', 'politics', 'geopolitics', 'markets', 'other'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const NEWS_CATEGORY_LABELS: Record<Language, Record<NewsCategory, string>> = {
  pl: {
    data: 'Dane makro',
    central_bank: 'Banki centralne',
    politics: 'Polityka i cła',
    geopolitics: 'Geopolityka',
    markets: 'Rynki',
    other: 'Inne',
  },
  en: {
    data: 'Economic data',
    central_bank: 'Central banks',
    politics: 'Politics & tariffs',
    geopolitics: 'Geopolitics',
    markets: 'Markets',
    other: 'Other',
  },
};

/** Default number of losing trades in a row (same day) that trigger the trading monitor alert; each user can change it. */
export const DEFAULT_LOSS_STREAK_ALERT = 3;

/** How the monitor counts losses for the warning: in a row (`streak`) or all of the day (`day`). */
export const LOSS_ALERT_MODES = ['streak', 'day'] as const;
export type LossAlertMode = (typeof LOSS_ALERT_MODES)[number];

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

const EMOTION_LABELS_EN: Record<string, string> = {
  calm: 'Calm',
  confident: 'Confidence',
  fear: 'Fear',
  fomo: 'FOMO',
  greed: 'Greed',
  impatience: 'Impatience',
  frustration: 'Frustration',
  revenge: 'Urge to win it back',
  boredom: 'Boredom',
  euphoria: 'Euphoria',
  doubt: 'Doubt',
};

/** Emotion label in the given language; the database keeps the Polish labels. */
export function emotionLabel(language: Language, key: string): string {
  if (language === 'en') return EMOTION_LABELS_EN[key] ?? key;
  return DEFAULT_EMOTIONS.find((e) => e.key === key)?.label ?? key;
}

/** Items every new pre-session checklist starts with, in the user's language. */
export const DEFAULT_CHECKLIST_ITEMS: Record<Language, readonly string[]> = {
  pl: [
    'Zaznaczone strefy płynności z wyższych interwałów (H4/D1/W1)',
    'Określony bias dnia',
    'Sprawdzone kluczowe newsy i dane makro',
    'Ustalone maksymalne ryzyko na dzień',
    'Plan wejścia i miejsce unieważnienia scenariusza',
  ],
  en: [
    'Higher-timeframe liquidity zones marked (H4/D1/W1)',
    'Daily bias defined',
    'Key news and macro data checked',
    'Maximum daily risk set',
    'Entry plan and invalidation level',
  ],
};
