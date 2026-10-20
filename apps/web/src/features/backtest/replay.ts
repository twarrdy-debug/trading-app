import { RESOLUTION_MS, type AnalysisResolution, type Candle } from '@trading/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBacktestCandles } from '../../api/hooks.ts';

/** The server takes stretches of at most this many periods of the stored resolution (M1 for M3). */
const CHUNK = 960;
/** Fetch the next stretch when fewer hidden candles than this are left. */
const AHEAD_MIN = 150;
/** Stretches tried in a row before giving up on finding candles (a long holiday). */
const MAX_EMPTY = 8;

const storedMs = (resolution: AnalysisResolution) => RESOLUTION_MS[resolution === 'M3' ? 'M1' : resolution];
/** A request spans whole candles of the resolution, so M3 buckets never split between two requests. */
const spanMs = (resolution: AnalysisResolution) => Math.floor((CHUNK * storedMs(resolution)) / RESOLUTION_MS[resolution]) * RESOLUTION_MS[resolution];
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A replay's candles: history before the cursor for context, and the stretch after it fetched as the
 * replay goes. `index` is the last candle shown; everything after it stays hidden.
 */
export function useReplayCandles(instrumentId: string, resolution: AnalysisResolution, cursorAt: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [index, setIndex] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const busy = useRef(false);
  const data = useRef<Candle[]>([]);
  data.current = candles;
  const position = useRef(-1);
  position.current = index;
  /** Bumped by `retry` to load again after a failed first load. */
  const [attempt, setAttempt] = useState(0);

  // (Re)load around the cursor: on open and when the timeframe changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExhausted(false);
    busy.current = false;
    setCandles([]);
    setIndex(-1);
    const span = spanMs(resolution);
    const period = RESOLUTION_MS[resolution];
    const cursor = Math.floor(Date.parse(cursorAt) / period) * period;
    void (async () => {
      try {
        let before: Candle[] = [];
        // Back from the cursor until there are candles (the start may fall on a weekend).
        for (let i = 0, to = cursor + period; i < MAX_EMPTY && before.length === 0; i++, to -= span) {
          before = (await fetchBacktestCandles(instrumentId, resolution, iso(to - span), iso(to))).candles;
        }
        if (cancelled) return;
        setCandles(before);
        setIndex(before.length - 1);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The cursor only seeds the load; moving it later does not reload.
  }, [instrumentId, resolution, attempt]);

  /** Fetches the next stretch after the last loaded candle, skipping stretches without trading. */
  const loadAhead = useCallback(async () => {
    if (busy.current || exhausted) return;
    const last = data.current.at(-1);
    if (!last) return;
    busy.current = true;
    try {
      const span = spanMs(resolution);
      let from = Date.parse(last.time) + RESOLUTION_MS[resolution];
      for (let i = 0; i < MAX_EMPTY; i++) {
        if (from >= Date.now()) {
          setExhausted(true);
          return;
        }
        const to = Math.min(from + span, Date.now());
        const next = (await fetchBacktestCandles(instrumentId, resolution, iso(from), iso(to))).candles;
        if (next.length) {
          setError(null);
          setCandles((list) => {
            const known = list.at(-1)?.time ?? '';
            return [...list, ...next.filter((c) => c.time > known)];
          });
          return;
        }
        from = to;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busy.current = false;
    }
  }, [instrumentId, resolution, exhausted]);

  useEffect(() => {
    if (!loading && index >= 0 && candles.length - 1 - index < AHEAD_MIN) void loadAhead();
  }, [index, candles.length, loading, loadAhead]);
  const ahead = useRef(loadAhead);
  ahead.current = loadAhead;

  /**
   * One candle forward; false when there is none loaded yet (or none left). At the end of what is
   * loaded it asks for the next stretch again, so a failed request does not stop the replay for good.
   */
  const step = useCallback(() => {
    if (position.current >= data.current.length - 1) {
      void ahead.current();
      return false;
    }
    position.current += 1;
    setIndex(position.current);
    return true;
  }, []);

  /** One candle back, never before `floor` (the last position event, which cannot be undone). */
  const back = useCallback((floor: number) => {
    position.current = Math.max(floor, position.current - 1);
    setIndex(position.current);
  }, []);

  return {
    /** Every loaded candle (the hidden ones too). */
    candles,
    /** The candles shown. */
    visible: index >= 0 ? candles.slice(0, index + 1) : [],
    index,
    current: index >= 0 ? (candles[index] ?? null) : null,
    loading,
    error,
    atEnd: exhausted && index >= candles.length - 1,
    step,
    back,
    retry: () => setAttempt((a) => a + 1),
  };
}
