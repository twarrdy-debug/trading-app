// Response types for clients (web, mobile). Type-only: import with `import type`.
import type { instruments } from './db/schema.ts';
import type { toPublicUser } from './routes/me.ts';
import type { basisOverview } from './services/basis.ts';
import type { listEvents, RefreshResult } from './services/calendar.ts';
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
export type TradeMutation = Jsonify<Awaited<ReturnType<typeof createTrade>>>;
export type TradeStats = Jsonify<Awaited<ReturnType<typeof tradeStats>>>;
export type BasisOverview = Jsonify<Awaited<ReturnType<typeof basisOverview>>>;
export type BasisPair = BasisOverview[number];
export type CalendarResponse = Jsonify<Awaited<ReturnType<typeof listEvents>>>;
export type CalendarEvent = CalendarResponse['events'][number];
export type CalendarRefresh = RefreshResult;
export type TradingMonitor = Jsonify<Awaited<ReturnType<typeof tradingMonitor>>>;

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
