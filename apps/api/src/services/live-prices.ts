/**
 * Live prices from Capital.com's streaming API for the analysis chart: one WebSocket for the whole
 * server, subscribed to the epics someone is watching, and the latest bid per epic passed on at most
 * once a second (bid, like the stored candles). Unofficial source for personal use, like the candles.
 */

export interface LiveQuote {
  epic: string;
  /** Bid price. */
  price: number;
  time: Date;
}

export interface LiveSource {
  /** Calls `listener` with the epic's latest price; returns the unsubscribe function. */
  subscribe(epic: string, listener: (quote: LiveQuote) => void): () => void;
  close(): void;
}

/** The parts of a WebSocket used here, so tests can pass a fake. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

const STREAM_URL = 'wss://api-streaming-capital.backend-capital.com/connect';
/** Capital.com closes a stream without a ping for 10 minutes. */
const PING_MS = 5 * 60_000;
/** Quotes arrive several times a second; the chart needs one a second. */
const EMIT_MS = 1_000;
/** Keep the socket a little after the last viewer leaves (a page reload, a timeframe switch). */
const IDLE_CLOSE_MS = 60_000;
const MAX_RETRY_MS = 60_000;
/** Capital.com allows 40 epics per stream. */
const MAX_EPICS = 40;

export function capitalLiveSource(
  auth: () => Promise<{ cst: string; token: string }>,
  connect: (url: string) => SocketLike = (url) => new WebSocket(url) as unknown as SocketLike,
  log: (msg: string) => void = () => {},
): LiveSource {
  const listeners = new Map<string, Set<(quote: LiveQuote) => void>>();
  const latest = new Map<string, LiveQuote>();
  const lastEmit = new Map<string, number>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let socket: SocketLike | null = null;
  let tokens: { cst: string; token: string } | null = null;
  let open = false;
  let ping: ReturnType<typeof setInterval> | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let retryMs = 3_000;
  let closed = false;
  let seq = 0;

  const send = (destination: string, payload?: object) => {
    if (!socket || !open || !tokens) return;
    socket.send(JSON.stringify({ destination, correlationId: String(++seq), cst: tokens.cst, securityToken: tokens.token, ...(payload ? { payload } : {}) }));
  };
  const epics = () => [...listeners.keys()].slice(0, MAX_EPICS);

  const emit = (epic: string) => {
    pending.delete(epic);
    const quote = latest.get(epic);
    if (!quote) return;
    lastEmit.set(epic, Date.now());
    for (const listener of listeners.get(epic) ?? []) listener(quote);
  };

  const onQuote = (quote: LiveQuote) => {
    latest.set(quote.epic, quote);
    if (pending.has(quote.epic)) return;
    const wait = (lastEmit.get(quote.epic) ?? 0) + EMIT_MS - Date.now();
    if (wait <= 0) emit(quote.epic);
    else pending.set(quote.epic, setTimeout(() => emit(quote.epic), wait));
  };

  const teardown = () => {
    open = false;
    if (ping) clearInterval(ping);
    ping = null;
    const s = socket;
    socket = null;
    if (s) {
      s.onclose = null;
      s.close();
    }
  };

  const start = async () => {
    if (socket || closed || listeners.size === 0) return;
    try {
      tokens = await auth();
    } catch (err) {
      log(`live prices: ${(err as Error).message}`);
      return scheduleRetry();
    }
    if (socket || closed || listeners.size === 0) return;
    const s = connect(STREAM_URL);
    socket = s;
    s.onopen = () => {
      open = true;
      retryMs = 3_000;
      send('marketData.subscribe', { epics: epics() });
      ping = setInterval(() => send('ping'), PING_MS);
    };
    s.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as { destination?: string; payload?: { epic?: string; bid?: number; timestamp?: number } };
        const p = msg.payload;
        if (msg.destination === 'quote' && p?.epic && typeof p.bid === 'number') onQuote({ epic: p.epic, price: p.bid, time: new Date(p.timestamp ?? Date.now()) });
      } catch {
        // Not JSON: ignore.
      }
    };
    s.onerror = () => s.close();
    s.onclose = () => {
      teardown();
      scheduleRetry();
    };
  };

  const scheduleRetry = () => {
    if (closed || retry || listeners.size === 0) return;
    retry = setTimeout(() => {
      retry = null;
      void start();
    }, retryMs);
    retryMs = Math.min(MAX_RETRY_MS, retryMs * 2);
  };

  return {
    subscribe(epic, listener) {
      if (idle) clearTimeout(idle);
      idle = null;
      let set = listeners.get(epic);
      const added = !set;
      if (!set) listeners.set(epic, (set = new Set()));
      set.add(listener);
      // The latest price at once, so a new viewer does not wait for the next move.
      const last = latest.get(epic);
      if (last) listener(last);
      if (!socket) void start();
      else if (added) send('marketData.subscribe', { epics: [epic] });
      return () => {
        set.delete(listener);
        if (set.size > 0) return;
        listeners.delete(epic);
        latest.delete(epic);
        send('marketData.unsubscribe', { epics: [epic] });
        if (listeners.size === 0) {
          idle = setTimeout(teardown, IDLE_CLOSE_MS);
        }
      };
    },
    close() {
      closed = true;
      for (const t of pending.values()) clearTimeout(t);
      if (idle) clearTimeout(idle);
      if (retry) clearTimeout(retry);
      teardown();
    },
  };
}
