import type { BacktestSession, BacktestTrade } from '@trading/api/types';
import { ANALYSIS_RESOLUTIONS, fillOnCandle, RESOLUTION_MS, type AnalysisResolution, type Direction } from '@trading/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client.ts';
import { useAllAccounts, useBacktestSession, useMe, useOpenBacktestTrade, useUpdateBacktestSession, useUpdateBacktestTrade } from '../../api/hooks.ts';
import { TradingChart, type ChartBox, type ChartLine } from '../../components/charts/TradingChart.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented } from '../../components/ui/Field.tsx';
import { Stat } from '../../components/ui/Stat.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale, formatAmount, formatNumber, formatPrice, formatSize, parseDecimal } from '../../lib/format.ts';
import { useReplayCandles } from './replay.ts';

type Session = BacktestSession;
type Trade = BacktestTrade;

/** Candles a second at each speed (0.25: one every 4 seconds). */
const SPEEDS = [0.25, 0.5, 1, 2, 5, 10] as const;
type Speed = (typeof SPEEDS)[number];
const SPEED_KEY = 'backtest-speed';
/** The last speed chosen, per browser. */
const loadSpeed = (): Speed => {
  try {
    const saved = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.find((v) => v === saved) ?? 1;
  } catch {
    return 1;
  }
};
/** Decimals a price is shown with: one more than the pip/tick/point (as in the analysis). */
const decimalsFor = (unitSize: number) => Math.min(5, Math.max(1, Math.ceil(-Math.log10(unitSize)) + 1));
const iso = (ms: number) => new Date(ms).toISOString();
const signedR = (r: number | null | undefined) => (r == null ? '—' : `${formatNumber(r, true)}R`);

/** One backtesting session: loads it, then the replay keyed by the session so its state starts fresh. */
export function ReplayView({ sessionId, onExit }: { sessionId: string; onExit: () => void }) {
  const t = useT().backtest;
  const { data: session, error } = useBacktestSession(sessionId);
  if (error) {
    return (
      <div className="card flex flex-col items-start gap-3 p-5">
        <span className="text-sm text-dim">{error instanceof ApiError ? error.lines.join(' ') : String(error)}</span>
        <Button size="sm" onClick={onExit}>
          {t.back}
        </Button>
      </div>
    );
  }
  if (!session) return <div className="card p-5 text-sm text-dim">{t.loading}</div>;
  return <Replay key={session.id} session={session} onExit={onExit} />;
}

function Replay({ session, onExit }: { session: Session; onExit: () => void }) {
  const all = useT();
  const t = all.backtest;
  const { data: me } = useMe();
  const { data: accounts = [] } = useAllAccounts();
  const timeZone = me?.settings.timezone ?? 'Europe/Warsaw';
  const accountCurrency = me?.settings.accountCurrency ?? 'USD';
  const account = accounts.find((a) => a.id === session.accountId);
  const { instrument } = session;

  const [resolution, setResolution] = useState<AnalysisResolution>(session.resolution as AnalysisResolution);
  const [seed, setSeed] = useState(session.cursorAt);
  const replay = useReplayCandles(instrument.id, resolution, seed);
  const period = RESOLUTION_MS[resolution];
  const current = replay.current;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<Speed>(loadSpeed);
  const setSpeed = (next: Speed) => {
    setSpeedState(next);
    try {
      localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      // Back to 1× on the next visit.
    }
  };

  const updateSession = useUpdateBacktestSession();
  const openTrade = useOpenBacktestTrade();
  const updateTrade = useUpdateBacktestTrade();
  const [errors, setErrors] = useState<string[]>([]);
  const fail = (err: unknown) => setErrors(err instanceof ApiError ? err.lines : [String(err)]);

  const trades = session.trades;
  const open = trades.filter((tr) => !tr.closedAt);
  const closing = useRef(new Set<string>());

  // Positions close by themselves when a newly shown candle reaches their stop or target.
  const processed = useRef<string | null>(null);
  useEffect(() => {
    if (!current) return;
    const last = processed.current;
    processed.current = current.time;
    // A fresh load or a step back shows nothing new.
    if (last == null || current.time <= last) return;
    const fresh = replay.candles.filter((c) => c.time > last && c.time <= current.time);
    for (const candle of fresh) {
      for (const trade of open) {
        // A position fills at a candle's close, so the candles after it can close it.
        if (closing.current.has(trade.id) || trade.openedAt > candle.time) continue;
        const fill = fillOnCandle(trade, candle);
        if (!fill) continue;
        closing.current.add(trade.id);
        updateTrade.mutate(
          { id: trade.id, close: { price: fill.price, at: iso(Date.parse(candle.time) + period), reason: fill.reason } },
          { onError: (err) => (closing.current.delete(trade.id), fail(err)) },
        );
      }
    }
    // Only a new candle matters; the positions are read as they are now.
  }, [current?.time]);

  // Reloading at another timeframe starts over: the first candle shown is not a new one.
  useEffect(() => {
    processed.current = null;
  }, [resolution]);

  // The cursor is saved quietly (no refetch) once the replay rests for a moment.
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => void api(`/backtest/sessions/${session.id}`, { method: 'PATCH', json: { cursorAt: current.time } }).catch(() => {}), 1500);
    return () => clearTimeout(timer);
  }, [current?.time, session.id]);

  // Playing: one candle per tick, waiting for the next stretch to load, stopping at the newest.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (!replay.step() && replay.atEnd) setPlaying(false);
    }, 1000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, replay.step, replay.atEnd]);

  /** Steps back stop at the last position event: what happened then cannot be replayed differently. */
  const floor = useMemo(() => {
    const events = trades.flatMap((tr) => [tr.openedAt, tr.closedAt]).filter((x): x is string => x != null);
    if (events.length === 0) return 0;
    const latest = events.sort().at(-1)!;
    return Math.max(0, replay.candles.findLastIndex((c) => c.time < latest));
  }, [trades, replay.candles]);

  // Keyboard: space plays or pauses, arrows step (not while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') replay.step();
      else if (e.key === 'ArrowLeft') replay.back(floor);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replay.step, replay.back, floor]);

  const chooseResolution = (next: AnalysisResolution) => {
    if (next === resolution) return;
    setPlaying(false);
    const at = current?.time ?? seed;
    setSeed(at);
    setResolution(next);
    updateSession.mutate({ id: session.id, resolution: next, cursorAt: at });
  };

  // --- The order form ---------------------------------------------------------
  const [size, setSize] = useState('1');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const sizeNum = parseDecimal(size);
  const slNum = parseDecimal(sl);
  const tpNum = parseDecimal(tp);
  const entry = current?.close ?? null;
  const riskQuote = entry != null && slNum != null && sizeNum ? (Math.abs(entry - slNum) / instrument.unitSize) * instrument.unitValue * sizeNum : null;
  const riskPct = riskQuote != null && account && instrument.quoteCurrency === accountCurrency && account.balance > 0 ? (riskQuote / account.balance) * 100 : null;

  const place = (direction: Direction) => {
    if (!current || !sizeNum) return;
    setErrors([]);
    openTrade.mutate(
      {
        sessionId: session.id,
        direction,
        size: sizeNum,
        entryPrice: current.close,
        stopLoss: slNum ?? null,
        takeProfit: tpNum ?? null,
        openedAt: iso(Date.parse(current.time) + period),
        checkedRuleIds: checked,
      },
      { onSuccess: () => setChecked([]), onError: fail },
    );
  };

  const closeNow = (trade: Trade) => {
    if (!current) return;
    closing.current.add(trade.id);
    updateTrade.mutate(
      { id: trade.id, close: { price: current.close, at: iso(Date.parse(current.time) + period), reason: 'manual' } },
      { onError: (err) => (closing.current.delete(trade.id), fail(err)) },
    );
  };

  /** Money and R of an open position at the current close, in the instrument's quote currency. */
  const live = (trade: Trade) => {
    if (!current) return null;
    const units = ((current.close - trade.entryPrice) * (trade.direction === 'long' ? 1 : -1)) / instrument.unitSize;
    const risk = trade.initialStopLoss != null ? Math.abs(trade.entryPrice - trade.initialStopLoss) / instrument.unitSize : null;
    return { money: units * instrument.unitValue * trade.size, r: risk ? units / risk : null };
  };

  // --- What the chart draws ---------------------------------------------------
  const decimals = decimalsFor(instrument.unitSize);
  const candleOf = (at: string) => iso(Math.floor((Date.parse(at) - 1) / period) * period);
  const { lines, boxes } = useMemo(() => {
    const lines: ChartLine[] = [];
    const boxes: ChartBox[] = [];
    for (const tr of trades) {
      if (!tr.closedAt) {
        lines.push({ price: tr.entryPrice, label: tr.direction === 'long' ? 'BUY' : 'SELL', color: tr.direction === 'long' ? 'long' : 'sell' });
        if (tr.stopLoss != null) lines.push({ price: tr.stopLoss, label: 'SL', color: 'sell' });
        if (tr.takeProfit != null) lines.push({ price: tr.takeProfit, label: 'TP', color: 'buy' });
      } else if (tr.exitPrice != null) {
        boxes.push({
          from: candleOf(tr.openedAt),
          to: candleOf(tr.closedAt),
          top: Math.max(tr.entryPrice, tr.exitPrice),
          bottom: Math.min(tr.entryPrice, tr.exitPrice),
          color: (tr.resultUnits ?? 0) >= 0 ? 'buy' : 'sell',
          fill: 0.16,
          label: signedR(tr.rMultiple),
        });
      }
    }
    return { lines, boxes };
  }, [trades, period]);

  const when = (at: string) => new Date(at).toLocaleString(currentLocale(), { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const summary = session.summary;
  const finished = session.finishedAt != null;

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <Button size="sm" variant="ghost" onClick={onExit}>
          {t.back}
        </Button>
        <span className="text-sm font-bold">
          {instrument.symbol} <span className="font-medium text-dim">· {instrument.name}</span>
        </span>
        <div className="max-w-full overflow-x-auto">
          <Segmented label={t.resolution} value={resolution} onChange={chooseResolution} options={ANALYSIS_RESOLUTIONS.map((r) => ({ value: r, label: r }))} />
        </div>
        <div className="grow" />
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => replay.back(floor)} aria-label={t.stepBack} title={t.stepBack} disabled={replay.index <= floor}>
            ◀︎
          </Button>
          <Button size="sm" variant="primary" onClick={() => setPlaying((p) => !p)} disabled={replay.loading || replay.atEnd} className="min-w-28">
            {playing ? `❚❚ ${t.pause}` : `▶ ${t.play}`}
          </Button>
          <Button size="sm" onClick={() => replay.step()} aria-label={t.stepForward} title={t.stepForward} disabled={replay.loading || replay.atEnd}>
            ▶︎
          </Button>
        </div>
        <Segmented label={t.speed} value={String(speed)} onChange={(v) => setSpeed(Number(v) as Speed)} options={SPEEDS.map((v) => ({ value: String(v), label: `${formatNumber(v)}×` }))} />
        {current && <span className="font-mono text-[13px] font-bold">{when(current.time)}</span>}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-(--radius) p-3 shadow-(--shadow)" style={{ background: 'var(--chart-bg)', color: 'var(--chart-text)' }}>
          {replay.visible.length > 0 ? (
            <TradingChart
              candles={replay.visible}
              overlays={NONE}
              boxes={boxes}
              segments={NONE}
              lines={lines}
              panes={NONE}
              decimals={decimals}
              timeZone={timeZone}
              watermark={`${instrument.symbol} · ${resolution}`}
              resetKey={`${session.id}:${resolution}`}
              ariaLabel={t.chartAria(instrument.symbol, resolution)}
              followNewest
            />
          ) : (
            <div className="flex h-[520px] flex-col items-center justify-center gap-3 text-sm">
              <span className="opacity-70">{replay.loading ? t.loading : replay.error ? t.loadFailed : t.noCandles}</span>
              {!replay.loading && replay.error && (
                <Button size="sm" onClick={replay.retry}>
                  {t.retry}
                </Button>
              )}
            </div>
          )}
          {replay.visible.length > 0 && replay.error && <span className="px-1 text-xs text-sell">{t.loadAheadFailed}</span>}
          {replay.atEnd && <span className="px-1 text-xs opacity-70">{t.end}</span>}
        </section>

        <div className="flex flex-col gap-3">
          <section className="card flex flex-col gap-3 p-4" aria-label={t.newPosition}>
            <h2 className="m-0 text-sm font-bold">{t.newPosition}</h2>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="buy" onClick={() => place('long')} disabled={!current || !sizeNum || finished || openTrade.isPending}>
                {t.buy}
              </Button>
              <Button variant="sell" onClick={() => place('short')} disabled={!current || !sizeNum || finished || openTrade.isPending}>
                {t.sell}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label={t.size}>
                <Input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} />
              </Field>
              <Field label={t.stopLoss}>
                <Input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder={entry != null ? formatPrice(entry) : ''} />
              </Field>
              <Field label={t.takeProfit}>
                <Input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
              </Field>
            </div>
            <span className="text-xs text-dim">
              {riskQuote != null ? `${t.risk(formatAmount(riskQuote, instrument.quoteCurrency, false), riskPct != null ? `${formatNumber(riskPct)}%` : null)} · ` : ''}
              {t.fillInfo}
            </span>
            {session.strategy && session.strategy.rules.length > 0 && (
              <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1 text-xs font-semibold text-dim">
                  {t.rules} · {session.strategy.name} ({checked.length}/{session.strategy.rules.length})
                </legend>
                {session.strategy.rules.map((rule) => (
                  <label key={rule.id} className="flex items-start gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-(--accent)"
                      checked={checked.includes(rule.id)}
                      onChange={() => setChecked((c) => (c.includes(rule.id) ? c.filter((x) => x !== rule.id) : [...c, rule.id]))}
                    />
                    {rule.label}
                  </label>
                ))}
              </fieldset>
            )}
            {errors.length > 0 && (
              <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-2.5 text-[12.5px] text-sell">
                {errors.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="card flex flex-col gap-2.5 p-4" aria-label={t.openPositions}>
            <h2 className="m-0 text-sm font-bold">{t.openPositions}</h2>
            {open.length === 0 && <span className="text-[13px] text-dim">{t.noOpen}</span>}
            {open.map((tr) => {
              const now = live(tr);
              const up = (now?.money ?? 0) >= 0;
              return (
                <div key={tr.id} className="flex flex-col gap-1.5 rounded-(--radius-control) bg-raised p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tr.direction === 'long' ? 'bg-long-soft text-long' : 'bg-sell-soft text-sell'}`}>
                      {tr.direction === 'long' ? 'BUY' : 'SELL'} · {formatSize(tr.size)}
                    </span>
                    <span className="font-mono text-xs text-dim">
                      {formatPrice(tr.entryPrice)} · SL {formatPrice(tr.stopLoss)} · TP {formatPrice(tr.takeProfit)}
                    </span>
                  </div>
                  {now && (
                    <span className={`font-mono text-lg font-bold ${up ? 'text-buy' : 'text-sell'}`}>
                      {formatAmount(now.money, instrument.quoteCurrency)} <span className="text-[13px]">{signedR(now.r)}</span>
                    </span>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => closeNow(tr)} disabled={!current}>
                      {t.closeNow}
                    </Button>
                    <Button size="sm" onClick={() => updateTrade.mutate({ id: tr.id, stopLoss: tr.entryPrice }, { onError: fail })} disabled={tr.stopLoss === tr.entryPrice}>
                      {t.toBreakeven}
                    </Button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="card grid grid-cols-2 gap-3 p-4" aria-label={t.sessionResult}>
            <h2 className="col-span-2 m-0 text-sm font-bold">{t.sessionResult}</h2>
            <MiniStat label={t.trades} value={String(summary.trades)} />
            <MiniStat label={t.winRate} value={summary.winRate == null ? '—' : `${formatNumber(summary.winRate)}%`} />
            <MiniStat label={t.totalR} value={signedR(summary.totalR)} tone={summary.totalR} />
            <MiniStat label={t.amount} value={formatAmount(summary.pnl, accountCurrency)} tone={summary.pnl} />
          </section>
        </div>
      </div>

      <Summary session={session} currency={accountCurrency} when={when} finished={finished} onFinish={(f) => updateSession.mutate({ id: session.id, finished: f })} />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  const color = tone == null || tone === 0 ? '' : tone > 0 ? 'text-buy' : 'text-sell';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold text-dim">{label}</span>
      <span className={`font-mono text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}

/** The session's figures, the cumulative result, the split by strategy rules and every trade. */
function Summary({ session, currency, when, finished, onFinish }: { session: Session; currency: string; when: (at: string) => string; finished: boolean; onFinish: (finished: boolean) => void }) {
  const all = useT();
  const t = all.backtest;
  const s = session.summary;
  const rows = [...session.trades].reverse();
  const tone = (n: number | null | undefined) => (n == null || n === 0 ? 'ink' : n > 0 ? 'buy' : 'sell') as 'ink' | 'buy' | 'sell';
  return (
    <section className="card flex flex-col gap-4 p-5" aria-label={t.summary}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-[15px] font-bold">{t.summary}</h2>
        {finished && <span className="rounded-full bg-chip px-2.5 py-0.5 text-[11px] font-bold text-dim">{t.finished}</span>}
        <div className="grow" />
        <Button size="sm" variant={finished ? 'secondary' : 'primary'} onClick={() => onFinish(!finished)}>
          {finished ? t.resume : t.finish}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-7">
        <Stat label={t.trades} value={String(s.trades)} foot={`${s.wins} / ${s.losses} / ${s.breakevens}`} />
        <Stat label={t.winRate} value={s.winRate == null ? '—' : `${formatNumber(s.winRate)}%`} />
        <Stat label={t.totalR} value={signedR(s.totalR)} tone={tone(s.totalR) === 'ink' ? undefined : tone(s.totalR)} />
        <Stat label={t.avgR} value={signedR(s.avgR)} tone={tone(s.avgR) === 'ink' ? undefined : tone(s.avgR)} />
        <Stat label={t.amount} value={formatAmount(s.pnl, currency)} tone={tone(s.pnl) === 'ink' ? undefined : tone(s.pnl)} />
        <Stat label={t.profitFactor} value={s.profitFactor == null ? '—' : formatNumber(s.profitFactor)} />
        <Stat label={t.maxDrawdown} value={formatAmount(-s.maxDrawdown, currency)} />
      </div>
      {s.curve.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow">{t.curve}</span>
          <Curve values={s.curve.map((p) => p.r)} />
        </div>
      )}
      {s.byRules && (
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t.byRules}</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['followed', 'broken'] as const).map((k) => {
              const b = s.byRules![k];
              return (
                <div key={k} className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-(--radius-control) p-3 ${k === 'followed' ? 'bg-buy-soft' : 'bg-raised'}`}>
                  <span className="text-[13px] font-bold">{k === 'followed' ? t.followed : t.broken}</span>
                  <span className="font-mono text-[13px]">
                    {b.trades} · {b.winRate == null ? '—' : `${formatNumber(b.winRate)}%`} · {signedR(b.totalR)} · {formatAmount(b.pnl, currency)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow">{t.tradesTitle}</span>
          <span className="text-xs text-dim">{t.advice}</span>
        </div>
        {rows.length === 0 ? (
          <span className="text-[13px] text-dim">{t.noTrades}</span>
        ) : (
          <div className="@container">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-dim">
                  <th className="py-1.5 pr-3 font-semibold">{t.columns.opened}</th>
                  <th className="py-1.5 pr-3 font-semibold">{t.columns.direction}</th>
                  <th className="hidden py-1.5 pr-3 font-semibold @min-[36rem]:table-cell">{t.columns.prices}</th>
                  <th className="py-1.5 pr-3 font-semibold">{t.columns.result}</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">{t.columns.r}</th>
                  <th className="py-1.5 text-right font-semibold">{t.columns.amount}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tr) => {
                  const color = tr.outcome === 'win' ? 'text-buy' : tr.outcome === 'loss' ? 'text-sell' : '';
                  return (
                    <tr key={tr.id} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono">
                        {when(tr.openedAt)}
                        {/* The prices column's figures, while the table is narrow. */}
                        <span className="block text-[11px] text-dim @min-[36rem]:hidden">
                          {formatPrice(tr.entryPrice)} → {formatPrice(tr.exitPrice)}
                        </span>
                      </td>
                      <td className={`py-2 pr-3 text-[11px] font-bold ${tr.direction === 'long' ? 'text-long' : 'text-sell'}`}>{tr.direction === 'long' ? 'BUY' : 'SELL'}</td>
                      <td className="hidden py-2 pr-3 font-mono @min-[36rem]:table-cell">
                        {formatPrice(tr.entryPrice)} → {formatPrice(tr.exitPrice)}
                      </td>
                      <td className={`py-2 pr-3 text-[11px] font-bold ${color}`}>{tr.exitReason ? (t.exit[tr.exitReason] ?? tr.exitReason) : t.open}</td>
                      <td className={`py-2 pr-3 text-right font-mono font-bold ${color}`}>{signedR(tr.rMultiple)}</td>
                      <td className={`py-2 text-right font-mono font-bold ${color}`}>{tr.pnl == null ? '—' : formatAmount(tr.pnl, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** Cumulative R after each closed trade, with the zero line. */
function Curve({ values }: { values: number[] }) {
  const width = 600;
  const height = 120;
  const points = [0, ...values];
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * (width - 8) + 4;
  const y = (v: number) => height - 6 - ((v - min) / span) * (height - 12);
  const last = points.at(-1)!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block h-32 w-full" role="img" aria-label={values.map((v) => signedR(v)).join(', ')}>
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline
        points={points.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
        fill="none"
        stroke={last >= 0 ? 'var(--buy)' : 'var(--sell)'}
        strokeWidth="2.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Stable empty lists, so the chart does not redraw its overlays on every render. */
const NONE: never[] = [];
