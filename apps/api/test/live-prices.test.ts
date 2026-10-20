import { afterEach, describe, expect, it, vi } from 'vitest';
import { capitalLiveSource, type SocketLike } from '../src/services/live-prices.ts';

/** A stand-in for Capital.com's stream that records what was sent. */
class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: { destination: string; payload?: { epics?: string[] } }[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  quote(epic: string, bid: number, timestamp: number) {
    this.onmessage?.({ data: JSON.stringify({ status: 'OK', destination: 'quote', payload: { epic, bid, ofr: bid + 1, timestamp } }) });
  }
}

describe('live prices', () => {
  afterEach(() => vi.useRealTimers());

  it('shares one stream, passes on the latest bid at most once a second and unsubscribes', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const live = capitalLiveSource(async () => ({ cst: 'c', token: 't' }), () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    const seen: number[] = [];
    const other: number[] = [];
    const stop = live.subscribe('US100', (q) => seen.push(q.price));
    const stopGold = live.subscribe('GOLD', (q) => other.push(q.price));
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    const socket = sockets[0]!;
    socket.onopen!();
    expect(socket.sent[0]).toMatchObject({ destination: 'marketData.subscribe', payload: { epics: ['US100', 'GOLD'] } });

    socket.quote('US100', 100, 1);
    socket.quote('US100', 101, 2);
    socket.quote('US100', 102, 3);
    socket.quote('GOLD', 4000, 3);
    expect(seen).toEqual([100]);
    await vi.advanceTimersByTimeAsync(1_000);
    // The quotes in between are skipped: the chart only needs the latest.
    expect(seen).toEqual([100, 102]);
    expect(other).toEqual([4000]);

    stop();
    expect(socket.sent.at(-1)).toMatchObject({ destination: 'marketData.unsubscribe', payload: { epics: ['US100'] } });
    stopGold();
    // The socket stays a minute for a viewer coming back, then closes.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(socket.closed).toBe(true);
    live.close();
  });

  it('reconnects after the stream drops while someone is watching', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const live = capitalLiveSource(async () => ({ cst: 'c', token: 't' }), () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    live.subscribe('US100', () => {});
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.onopen!();
    sockets[0]!.onclose!();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sockets).toHaveLength(2);
    live.close();
  });
});
