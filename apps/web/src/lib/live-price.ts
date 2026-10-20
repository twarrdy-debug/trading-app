import { withLivePrice, type Candle, type LivePrice } from '@trading/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The instrument's live price from the server's stream (`/analysis/live/:id`, about once a second),
 * null until the first one or when the stream is unavailable. EventSource reconnects by itself.
 */
export function useLivePrice(instrumentId: string | null): { price: LivePrice | null; connected: boolean } {
  const [price, setPrice] = useState<LivePrice | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    setPrice(null);
    setConnected(false);
    if (!instrumentId || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/analysis/live/${instrumentId}`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('price', (e) => {
      setConnected(true);
      setPrice(JSON.parse((e as MessageEvent<string>).data) as LivePrice);
    });
    return () => source.close();
  }, [instrumentId]);
  return { price, connected };
}

/**
 * The chart's candles kept up to date by the live price between the server's refreshes: candles it
 * opened stay until the next refresh replaces them with the source's own.
 */
export function useLiveCandles(base: Candle[] | undefined, live: LivePrice | null, periodMs: number, daily: boolean): Candle[] {
  const built = useRef<{ base: Candle[] | undefined; candles: Candle[] }>({ base: undefined, candles: [] });
  return useMemo(() => {
    if (!base) return [];
    const from = built.current.base === base ? built.current.candles : base;
    const candles = withLivePrice(from, live, periodMs, daily);
    built.current = { base, candles };
    return candles;
  }, [base, live, periodMs, daily]);
}
