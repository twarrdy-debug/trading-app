// Response types for clients (web, mobile). Type-only: import with `import type`.
import type { instruments } from './db/schema.ts';
import type { toPublicUser } from './routes/me.ts';
import type { AccountOverview, accountOverviews, TradingAccount as TradingAccountRow } from './services/accounts.ts';
import type { basisOverview } from './services/basis.ts';
import type { proCandles } from './services/calculator-pro.ts';
import type { createApiKey, listApiKeys } from './services/api-keys.ts';
import type { accountDayBalance, listAdjustments } from './services/accounts.ts';
import type { backtestCandles, getBacktestSession, listBacktestSessions } from './services/backtest.ts';
import type { analysisOverview, marketAnalysis } from './services/market-analysis.ts';
import type { eventHistory, listEvents, RefreshResult } from './services/calendar.ts';
import type { invites } from './db/schema.ts';
import type { importMt5 } from './services/mt5-import.ts';
import type { listNews } from './services/news.ts';
import type { StrategyView } from './services/strategies.ts';
import type { appStats, listAllInstruments, listUsers, systemStatus } from './services/admin.ts';
import type { createTrade, listTrades, tradeStats, tradingMonitor, TradeView } from './services/trades.ts';

/** What a value looks like after JSON serialization (Dates become strings). */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

/** `tradesUsed` comes with GET /me (not with the answers of settings changes). */
export type PublicUser = Jsonify<ReturnType<typeof toPublicUser>> & { tradesUsed?: number | null };
/** `favorite`: one of the acting user's favourite instruments. */
export type Instrument = Jsonify<typeof instruments.$inferSelect & { currencies: string[]; favorite: boolean }>;
export type Trade = Jsonify<TradeView>;
export type TradeList = Jsonify<Awaited<ReturnType<typeof listTrades>>>;
export type TradeMutation = Jsonify<Omit<Awaited<ReturnType<typeof createTrade>>, 'fxWarning'>>;
export type TradeStats = Jsonify<Awaited<ReturnType<typeof tradeStats>>>;
export type BasisOverview = Jsonify<Awaited<ReturnType<typeof basisOverview>>>;
export type BasisPair = BasisOverview[number];
export type ProCandles = Jsonify<Awaited<ReturnType<typeof proCandles>>>;
export type AccountAdjustment = Jsonify<Awaited<ReturnType<typeof listAdjustments>>[number]>;
export type AccountDayBalance = Jsonify<Awaited<ReturnType<typeof accountDayBalance>>>;
export type ApiKeyListItem = Jsonify<Awaited<ReturnType<typeof listApiKeys>>[number]>;
export type CreatedApiKey = Jsonify<Awaited<ReturnType<typeof createApiKey>>>;
export type BacktestCandles = Jsonify<Awaited<ReturnType<typeof backtestCandles>>>;
export type BacktestSession = Jsonify<Awaited<ReturnType<typeof getBacktestSession>>>;
export type BacktestSessionListItem = Jsonify<Awaited<ReturnType<typeof listBacktestSessions>>[number]>;
export type BacktestTrade = BacktestSession['trades'][number];
export type CalendarResponse = Jsonify<Awaited<ReturnType<typeof listEvents>>>;
export type CalendarEvent = CalendarResponse['events'][number];
export type CalendarRefresh = RefreshResult;
export type MarketAnalysis = Jsonify<Awaited<ReturnType<typeof marketAnalysis>>>;
export type AnalysisOverview = Jsonify<Awaited<ReturnType<typeof analysisOverview>>>;
export type EventHistory = Jsonify<NonNullable<Awaited<ReturnType<typeof eventHistory>>>>;
export type NewsResponse = Jsonify<Awaited<ReturnType<typeof listNews>>>;
export type NewsItem = NewsResponse['items'][number];
export type TradingMonitor = Jsonify<Awaited<ReturnType<typeof tradingMonitor>>>;
export type AccountSummary = Jsonify<AccountOverview>;
/** An account in `GET /accounts`: its figures plus the number of its trades. */
export type AccountListItem = Jsonify<Awaited<ReturnType<typeof accountOverviews>>[number]>;
export type TradingAccount = Jsonify<TradingAccountRow>;
export type Invite = Jsonify<typeof invites.$inferSelect>;
/** A new invite; `emailed` when it was sent to its address. */
export type CreatedInvite = Invite & { emailed: boolean };
export interface AuthConfig {
  registration: 'invite' | 'open' | 'closed';
  devBypass: boolean;
}
export type AdminUser = Jsonify<Awaited<ReturnType<typeof listUsers>>[number]>;
export type AdminStats = Jsonify<Awaited<ReturnType<typeof appStats>>>;
export type SystemStatus = Jsonify<Awaited<ReturnType<typeof systemStatus>>>;
export type AdminInstrument = Jsonify<Awaited<ReturnType<typeof listAllInstruments>>[number]>;
export type Strategy = Jsonify<StrategyView>;
export type StrategyRule = Strategy['rules'][number];
export type Mt5Import = Jsonify<Awaited<ReturnType<typeof importMt5>>>;
export type Mt5ImportRow = Mt5Import['positions'][number];

export interface Emotion {
  key: string;
  label: string;
}

export interface Educator {
  id: string;
  displayName: string;
}

export interface DailySpread {
  instrumentId: string;
  date: string;
  spread: number | null;
  askUser: boolean;
  suggestion: { spread: number; date: string } | null;
}

export interface ApiErrorBody {
  error: string;
  /** The message key (e.g. `demoReadOnly`), for clients that react to a specific refusal. */
  code?: string;
  issues?: { path: string; message: string }[];
  details?: unknown;
}
