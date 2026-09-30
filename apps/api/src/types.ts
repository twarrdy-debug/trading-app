// Response types for clients (web, mobile). Type-only: import with `import type`.
import type { instruments } from './db/schema.ts';
import type { toPublicUser } from './routes/me.ts';
import type { AccountOverview, TradingAccount as TradingAccountRow } from './services/accounts.ts';
import type { basisOverview } from './services/basis.ts';
import type { listEvents, RefreshResult } from './services/calendar.ts';
import type { invites } from './db/schema.ts';
import type { importMt5 } from './services/mt5-import.ts';
import type { listNews } from './services/news.ts';
import type { createTrade, listTrades, tradeStats, tradingMonitor, TradeView } from './services/trades.ts';

/** What a value looks like after JSON serialization (Dates become strings). */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type PublicUser = Jsonify<ReturnType<typeof toPublicUser>>;
export type Instrument = Jsonify<typeof instruments.$inferSelect & { currencies: string[] }>;
export type Trade = Jsonify<TradeView>;
export type TradeList = Jsonify<Awaited<ReturnType<typeof listTrades>>>;
export type TradeMutation = Jsonify<Omit<Awaited<ReturnType<typeof createTrade>>, 'fxWarning'>>;
export type TradeStats = Jsonify<Awaited<ReturnType<typeof tradeStats>>>;
export type BasisOverview = Jsonify<Awaited<ReturnType<typeof basisOverview>>>;
export type BasisPair = BasisOverview[number];
export type CalendarResponse = Jsonify<Awaited<ReturnType<typeof listEvents>>>;
export type CalendarEvent = CalendarResponse['events'][number];
export type CalendarRefresh = RefreshResult;
export type NewsResponse = Jsonify<Awaited<ReturnType<typeof listNews>>>;
export type NewsItem = NewsResponse['items'][number];
export type TradingMonitor = Jsonify<Awaited<ReturnType<typeof tradingMonitor>>>;
export type AccountSummary = Jsonify<AccountOverview>;
export type TradingAccount = Jsonify<TradingAccountRow>;
export type Invite = Jsonify<typeof invites.$inferSelect>;
export interface AuthConfig {
  registration: 'invite' | 'open' | 'closed';
  devBypass: boolean;
}
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
  issues?: { path: string; message: string }[];
  details?: unknown;
}
