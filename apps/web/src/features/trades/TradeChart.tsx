import type { Instrument } from '@trading/api/types';
import { atr, type AnalysisResolution, type Direction } from '@trading/shared';
import { useCallback, useMemo, useState } from 'react';
import { useMarketAnalysis } from '../../api/hooks.ts';
import { TradingChart, type EditableLine } from '../../components/charts/TradingChart.tsx';
import { Segmented } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';

const TFS: AnalysisResolution[] = ['M1', 'M5', 'M15', 'H1', 'H4'];
const TF_KEY = 'trade-chart-tf';
const NONE: never[] = [];

const loadTf = (): AnalysisResolution => {
  try {
    const saved = localStorage.getItem(TF_KEY) as AnalysisResolution | null;
    return saved && TFS.includes(saved) ? saved : 'M5';
  } catch {
    return 'M5';
  }
};

/** Prices shown with one decimal more than the pip, tick or point (as in the analysis). */
export const decimalsFor = (unitSize: number) => Math.min(5, Math.max(1, Math.ceil(-Math.log10(unitSize)) + 1));

export interface ChartLevels {
  entry: number | null;
  stopLoss: number | null;
  takeProfits: (number | null)[];
}

/**
 * The trade form's chart (Pro and VIP): the instrument's candles with the entry (blue for BUY, red
 * for SELL), the stop (red, dashed) and the take profits (green, dashed) as lines the user drags;
 * each move writes the price into the form. Buttons place the entry at the last price and a stop or
 * a target a sensible distance away.
 */
export function TradeChart({
  instrument,
  direction,
  levels,
  timeZone,
  labelFor,
  onEntry,
  onStop,
  onTarget,
  onAddTarget,
  onRemoveTarget,
}: {
  instrument: Instrument;
  direction: Direction;
  levels: ChartLevels;
  timeZone: string;
  /** "−$243 · −1R" beside a level, when the size and stop allow it. */
  labelFor: (price: number) => string;
  onEntry: (price: number) => void;
  onStop: (price: number) => void;
  onTarget: (index: number, price: number) => void;
  onAddTarget: (price: number) => void;
  onRemoveTarget: () => void;
}) {
  const t = useT().tradeChart;
  const [tf, setTfState] = useState<AnalysisResolution>(loadTf);
  const { data, isLoading } = useMarketAnalysis(instrument.id, tf);
  const candles = data?.candles ?? [];
  const decimals = decimalsFor(instrument.unitSize);
  // Futures move in whole ticks; CFDs and forex in the prices' own decimals.
  const round = useCallback(
    (price: number) => (instrument.market === 'futures' ? Math.round(price / instrument.unitSize) * instrument.unitSize : Number(price.toFixed(decimals))),
    [instrument.market, instrument.unitSize, decimals],
  );
  const last = candles.at(-1)?.close ?? null;
  const range = useMemo(() => atr(candles.slice(-60)) ?? (last ? last * 0.002 : 1), [candles, last]);
  const sign = direction === 'long' ? 1 : -1;

  const setTf = (next: AnalysisResolution) => {
    setTfState(next);
    try {
      localStorage.setItem(TF_KEY, next);
    } catch {
      // Back to M5 next time.
    }
  };

  const lines = useMemo(() => {
    const out: EditableLine[] = [];
    const label = (p: number) => {
      const extra = labelFor(p);
      return extra ? ` ${extra}` : '';
    };
    if (levels.entry != null) out.push({ id: 'entry', price: levels.entry, label: direction === 'long' ? 'BUY' : 'SELL', color: direction === 'long' ? 'long' : 'sell' });
    if (levels.stopLoss != null) out.push({ id: 'sl', price: levels.stopLoss, label: `SL${label(levels.stopLoss)}`, color: 'sell', dashed: true });
    levels.takeProfits.forEach((tp, i) => {
      if (tp != null) out.push({ id: `tp${i}`, price: tp, label: `TP${levels.takeProfits.length > 1 ? i + 1 : ''}${label(tp)}`, color: 'buy', dashed: true });
    });
    return out;
  }, [levels, direction, labelFor]);

  const drag = useCallback(
    (id: string, price: number) => {
      const p = round(price);
      if (id === 'entry') onEntry(p);
      else if (id === 'sl') onStop(p);
      else if (id.startsWith('tp')) onTarget(Number(id.slice(2)), p);
    },
    [round, onEntry, onStop, onTarget],
  );

  const entry = levels.entry ?? last;
  const stopDistance = levels.entry != null && levels.stopLoss != null ? Math.abs(levels.entry - levels.stopLoss) : range;
  const tpCount = levels.takeProfits.filter((tp) => tp != null).length;
  const tool = 'h-8 rounded-[10px] px-3 text-[12.5px] font-bold transition hover:brightness-110 disabled:opacity-40';

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-(--radius) p-3 shadow-(--shadow)" style={{ background: 'var(--chart-bg)', color: 'var(--chart-text)' }} aria-label={t.aria(instrument.symbol)}>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-sm font-bold">{instrument.symbol}</span>
        <Segmented label={t.timeframe} value={tf} onChange={setTf} options={TFS.map((r) => ({ value: r, label: r }))} />
        <span className="grow" />
        <button type="button" className={`${tool} ${direction === 'long' ? 'bg-long-soft text-long' : 'bg-sell-soft text-sell'}`} disabled={last == null} onClick={() => last != null && onEntry(round(last))}>
          + {t.entry}
        </button>
        <button type="button" className={`${tool} bg-sell-soft text-sell`} disabled={entry == null} onClick={() => entry != null && onStop(round(entry - sign * range * 0.8))}>
          + SL
        </button>
        <button
          type="button"
          className={`${tool} bg-buy-soft text-buy`}
          disabled={entry == null}
          onClick={() => entry != null && onAddTarget(round(entry + sign * stopDistance * (1.5 + tpCount)))}
        >
          + TP
        </button>
        {tpCount > 0 && (
          <button type="button" className={`${tool} bg-chip text-dim`} onClick={onRemoveTarget} title={t.removeTp}>
            − TP
          </button>
        )}
      </div>
      {candles.length > 0 ? (
        <TradingChart
          candles={candles}
          overlays={NONE}
          boxes={NONE}
          segments={NONE}
          lines={NONE}
          panes={NONE}
          decimals={decimals}
          timeZone={timeZone}
          height={460}
          watermark={`${instrument.symbol} · ${tf}`}
          resetKey={`${instrument.id}:${tf}`}
          ariaLabel={t.aria(instrument.symbol)}
          editLines={lines}
          onLineDrag={drag}
        />
      ) : (
        <div className="flex h-[460px] items-center justify-center text-sm opacity-70">{isLoading ? t.loading : t.noData}</div>
      )}
      <span className="px-1 text-[11.5px] opacity-60">{t.hint}</span>
    </section>
  );
}
