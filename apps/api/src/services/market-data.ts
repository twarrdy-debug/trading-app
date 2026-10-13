import type { AnalysisResolution, Candle } from '@trading/shared';

/**
 * Market data for the analysis and the calculator: candles, the current price and client sentiment.
 * The live source is the Capital.com API (a free key from a demo account); tests inject a fake.
 * It is an unofficial source for personal use: clarify its terms before other users rely on it.
 */
export interface MarketDataProvider {
  fetchCandles(epic: string, resolution: AnalysisResolution, options: { max?: number; from?: Date }): Promise<Candle[]>;
  /** Mid price (between bid and ask) and when it was quoted. */
  fetchQuote(epic: string): Promise<{ price: number; time: Date }>;
  /** Share of the source's clients long and short on each market, in %. */
  fetchSentiment(epics: string[]): Promise<{ epic: string; long: number; short: number }[]>;
}

const CAPITAL_RESOLUTION: Record<AnalysisResolution, string> = { M5: 'MINUTE_5', M15: 'MINUTE_15', H1: 'HOUR', H4: 'HOUR_4', D1: 'DAY' };

/** Capital.com allows 10 requests a second per user; stay well under it. */
const MIN_GAP_MS = 150;
/** Sessions expire after 10 minutes without a request; renew a little earlier. */
const SESSION_MS = 9 * 60_000;

interface CapitalPrice {
  snapshotTimeUTC: string;
  openPrice: { bid: number; ask: number };
  highPrice: { bid: number; ask: number };
  lowPrice: { bid: number; ask: number };
  closePrice: { bid: number; ask: number };
}

export function capitalProvider(config: { env: 'demo' | 'live'; identifier: string; apiKey: string; password: string }): MarketDataProvider {
  const base = config.env === 'live' ? 'https://api-capital.backend-capital.com/api/v1' : 'https://demo-api-capital.backend-capital.com/api/v1';
  let session: { cst: string; token: string; until: number } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let last = 0;

  /** One request at a time, at most one every MIN_GAP_MS. */
  const throttled = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      const wait = last + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return run();
    });
    queue = next.catch(() => undefined);
    return next;
  };

  const login = async () => {
    const res = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'X-CAP-API-KEY': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: config.identifier, password: config.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { errorCode?: string };
      throw new Error(`Capital.com login ${res.status} ${body.errorCode ?? ''}`.trim());
    }
    session = { cst: res.headers.get('CST') ?? '', token: res.headers.get('X-SECURITY-TOKEN') ?? '', until: Date.now() + SESSION_MS };
  };

  const get = async <T>(path: string, retry = true): Promise<T> =>
    throttled(async () => {
      if (!session || session.until < Date.now()) await login();
      const res = await fetch(`${base}${path}`, {
        headers: { CST: session!.cst, 'X-SECURITY-TOKEN': session!.token },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 && retry) {
        session = null;
        return null;
      }
      if (!res.ok) throw new Error(`Capital.com ${path.split('?')[0]} ${res.status}`);
      session!.until = Date.now() + SESSION_MS;
      return (await res.json()) as T;
    }).then((body) => (body === null && retry ? get<T>(path, false) : (body as T)));

  return {
    async fetchCandles(epic, resolution, { max = 1000, from }) {
      const params = new URLSearchParams({ resolution: CAPITAL_RESOLUTION[resolution], max: String(max) });
      // Capital.com reads `from` as UTC without a zone suffix.
      if (from) params.set('from', from.toISOString().slice(0, 19));
      const body = await get<{ prices: CapitalPrice[] }>(`/prices/${encodeURIComponent(epic)}?${params}`);
      // Bid prices, as broker charts show them by default.
      return body.prices.map((p) => ({
        time: new Date(`${p.snapshotTimeUTC}Z`).toISOString(),
        open: p.openPrice.bid,
        high: p.highPrice.bid,
        low: p.lowPrice.bid,
        close: p.closePrice.bid,
      }));
    },
    async fetchQuote(epic) {
      // The latest one-minute candle: its close is the current price and snapshotTimeUTC a real UTC
      // time (the market snapshot's updateTime is in the platform's own zone, not UTC). When the
      // market is closed the candle is old, so the quote reads as stale.
      const body = await get<{ prices: CapitalPrice[] }>(`/prices/${encodeURIComponent(epic)}?resolution=MINUTE&max=1`);
      const last = body.prices.at(-1);
      if (!last) throw new Error(`Capital.com ${epic}: no prices`);
      return {
        price: Math.round(((last.closePrice.bid + last.closePrice.ask) / 2) * 100) / 100,
        time: new Date(`${last.snapshotTimeUTC}Z`),
      };
    },
    async fetchSentiment(epics) {
      const body = await get<{ clientSentiments: { marketId: string; longPositionPercentage: number; shortPositionPercentage: number }[] }>(
        `/clientsentiment?marketIds=${epics.map(encodeURIComponent).join(',')}`,
      );
      return body.clientSentiments.map((s) => ({ epic: s.marketId, long: s.longPositionPercentage, short: s.shortPositionPercentage }));
    },
  };
}
