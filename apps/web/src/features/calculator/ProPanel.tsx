import {
  findCandleHits,
  PRO_RESOLUTION_MS,
  PRO_RESOLUTIONS,
  readAtHit,
  roundToStep,
  type CandleHit,
  type CfdFuturesPair,
  type ProResolution,
} from '@trading/shared';
import { useMemo, useState } from 'react';
import { useMe, useProCandles } from '../../api/hooks.ts';
import { ChartSync } from '../../components/charts/chart-sync.ts';
import { TradingChart, type ChartBox, type ChartLine } from '../../components/charts/TradingChart.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Segmented } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';
import { PlanGate } from '../plans/PlanLocked.tsx';
import { currentLocale, formatNumber, formatPrice } from '../../lib/format.ts';

type Side = 'cfd' | 'futures';

export interface ProLevel {
  /** IN, SL, TP1, TP2 */
  tag: string;
  label: string;
  /** The typed price, on the levels' market. */
  price: number;
}

const TF_KEY = 'calc-pro-tf';

function loadTf(): ProResolution {
  try {
    const stored = localStorage.getItem(TF_KEY);
    return PRO_RESOLUTIONS.find((r) => r === stored) ?? 'M5';
  } catch {
    return 'M5';
  }
}

/** Line and tile colours per level. */
const TONE = (tag: string) => (tag === 'IN' ? 'accent' : tag === 'SL' ? 'sell' : 'buy');

/**
 * Calculator PRO: each level is looked up on the candle it came from (newest first, the others
 * listed) and read from the same candle on the other market; both charts show the levels and the
 * candles, with scrolling and the crosshair linked. Without such a candle the difference is used.
 */
export function ProPanel(props: Parameters<typeof ProPanelLive>[0]) {
  const t = useT();
  // Pro and VIP only; the demo does not open it either (outside data, for signed-in users).
  return (
    <PlanGate feature="calculatorPro" demo={{ title: t.demo.proTitle, text: t.demo.proText }} plan={{ title: t.plans.proTitle, text: t.plans.proText }}>
      <ProPanelLive {...props} />
    </PlanGate>
  );
}

function ProPanelLive({
  pair,
  levelsSide,
  levels,
  convert,
  tick,
  copyHeader,
}: {
  pair: CfdFuturesPair;
  levelsSide: Side;
  levels: ProLevel[];
  /** The difference method from the calculator above (null until the difference is known). */
  convert: ((price: number, target: Side) => number) | null;
  tick: number;
  /** First line of the copied text, e.g. "NQ1 / MNQ1 - BUY". */
  copyHeader: (target: Side) => string;
}) {
  const all = useT();
  const t = all.calculator.pro;
  const { data: me } = useMe();
  const timeZone = me?.settings.timezone ?? 'Europe/Warsaw';
  const [tf, setTfState] = useState<ProResolution>(loadTf);
  const { data, isLoading } = useProCandles(pair.key, tf);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const sync = useMemo(() => new ChartSync(), []);

  const setTf = (next: ProResolution) => {
    setTfState(next);
    try {
      localStorage.setItem(TF_KEY, next);
    } catch {
      // Back to M5 on the next visit.
    }
  };

  const fut = `${pair.mini} / ${pair.micro}`;
  const target: Side = levelsSide === 'cfd' ? 'futures' : 'cfd';
  const candles = { cfd: data?.cfd.candles ?? [], futures: data?.futures.candles ?? [] };
  const futuresLast = data?.futures.lastCandleAt ?? null;
  const futDecimals = (String(tick).split('.')[1] ?? '').length;
  const round = (price: number, side: Side) => (side === 'futures' ? roundToStep(price, tick) : Math.round(price * 100) / 100);
  const when = (iso: string) => new Date(iso).toLocaleString(currentLocale(), { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const rows = levels.map((level) => {
    const hits = findCandleHits(candles[levelsSide], level.price, pair.matchPoints);
    const hit = hits.find((h) => h.time === picked[level.tag]) ?? hits[0] ?? null;
    const read = hit ? readAtHit(candles[target], hit) : null;
    const byBasis = convert ? convert(level.price, target) : null;
    const reason: 'noHit' | 'pending' | 'missing' | null = !hit
      ? 'noHit'
      : read != null
        ? null
        : target === 'futures' && (!futuresLast || hit.time > futuresLast)
          ? 'pending'
          : 'missing';
    const result = read != null ? round(read, target) : byBasis;
    return { ...level, hits, hit, result, reason };
  });
  const entry = rows.find((r) => r.tag === 'IN' && r.hit) ?? rows.find((r) => r.hit);
  const focus = entry?.hit ? { time: entry.hit.time, key: `${entry.hit.time}|${tf}|${pair.key}` } : null;

  /** Lines at each market's price and the levels' candles outlined in their colour. */
  const overlay = (side: Side) => {
    const lines: ChartLine[] = [];
    const boxes: ChartBox[] = [];
    for (const r of rows) {
      const price = side === levelsSide ? r.price : r.result;
      if (price != null) lines.push({ price, label: r.tag, color: TONE(r.tag) });
      const c = r.hit && candles[side].find((k) => k.time === r.hit!.time);
      if (c) {
        boxes.push({
          from: c.time,
          to: null,
          bar: true,
          top: c.high,
          bottom: c.low,
          color: TONE(r.tag),
          fill: 0.22,
        });
      }
    }
    return { lines, boxes };
  };
  const cfdOverlay = useMemo(() => overlay('cfd'), [JSON.stringify(rows), data]);
  const futOverlay = useMemo(() => overlay('futures'), [JSON.stringify(rows), data]);

  const how = (r: (typeof rows)[number]) =>
    r.reason === 'noHit' ? t.noHit : r.reason === 'pending' ? t.pending(data?.futures.delayMinutes ?? 10) : r.reason === 'missing' ? t.missing : t.how(t.point[r.hit!.point], tf, when(r.hit!.time));

  const decimals = target === 'futures' ? futDecimals : 2;
  const copyText = rows.some((r) => r.result != null)
    ? [copyHeader(target), ...rows.filter((r) => r.result != null).map((r) => `${r.tag}: ${r.result!.toFixed(decimals)}`)].join('\n')
    : null;
  const copy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const charts = [
    { side: 'cfd' as const, symbol: `${pair.cfd} · CFD`, source: t.cfdSource, decimals: 2, overlay: cfdOverlay },
    { side: 'futures' as const, symbol: `${pair.mini} · futures`, source: t.futuresSource(data?.futures.symbol ?? '', data?.futures.delayMinutes ?? 10), decimals: futDecimals, overlay: futOverlay },
  ];
  const sourceSymbol = levelsSide === 'cfd' ? pair.cfd : fut;
  const targetSymbol = target === 'cfd' ? pair.cfd : fut;
  const noCfd = data != null && data.cfd.candles.length === 0;

  return (
    <section aria-label={t.title} className="card flex flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-1">
        <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold">
          {t.title}
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-extrabold text-on-accent">PRO</span>
        </h2>
        <div className="grow" />
        <Segmented label={t.resolution} value={tf} onChange={setTf} options={PRO_RESOLUTIONS.map((r) => ({ value: r, label: r }))} />
      </header>
      <p className="m-0 px-5 pb-3 text-[13px] text-dim">{t.intro}</p>

      {noCfd ? (
        <p className="m-0 mx-5 mb-5 rounded-(--radius-control) bg-raised p-4 text-sm text-dim">{t.unavailable}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-5 lg:grid-cols-2">
          {charts.map((c) => (
            <div key={c.side} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-raised p-3">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1">
                <span className="text-sm font-bold">{c.symbol}</span>
                <span className="text-xs text-dim">{c.source}</span>
                <div className="grow" />
                {entry?.hit && (
                  <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-bold text-accent-ink">{t.entryCandle(entry.tag, tf, when(entry.hit.time))}</span>
                )}
              </div>
              <div className="overflow-hidden rounded-xl">
                {candles[c.side].length > 0 ? (
                  <TradingChart
                    candles={candles[c.side]}
                    overlays={NONE}
                    boxes={c.overlay.boxes}
                    segments={NONE}
                    lines={c.overlay.lines}
                    panes={NONE}
                    decimals={c.decimals}
                    timeZone={timeZone}
                    height={440}
                    watermark={`${c.side === 'cfd' ? pair.cfd : pair.mini} · ${tf}`}
                    resetKey={`${pair.key}:${tf}:${c.side}`}
                    ariaLabel={t.chartLabel(c.symbol, tf)}
                    sync={sync}
                    focus={focus}
                    periodMs={c.side === 'cfd' ? PRO_RESOLUTION_MS[tf] : undefined}
                  />
                ) : (
                  <div className="flex h-[440px] items-center justify-center bg-panel text-sm text-dim">
                    {isLoading ? t.loading : c.side === 'futures' && data?.errors.futures ? t.futuresError : t.loading}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
        <h3 className="m-0 text-sm font-bold">{t.levelsTitle}</h3>
        {rows.length === 0 ? (
          <p className="m-0 text-[13px] text-dim">{t.noLevels}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {rows.map((r) => {
              const tone = r.tag === 'IN' ? 'bg-raised' : r.tag === 'SL' ? 'bg-sell-soft' : 'bg-buy-soft';
              const others = r.hits.filter((h) => h !== r.hit);
              return (
                <div key={r.tag} className={`flex min-w-0 flex-col gap-1.5 rounded-2xl p-3.5 ${tone}`}>
                  <span className="text-xs font-bold">{r.label}</span>
                  <span className="font-mono text-xs text-dim">
                    {sourceSymbol} {formatPrice(r.price)}
                  </span>
                  <span className="truncate font-mono text-xl font-bold" aria-live="polite">
                    {r.result == null ? '—' : formatPrice(r.result)}
                  </span>
                  <span className="text-[11.5px] text-dim">{targetSymbol}</span>
                  <span className={`text-[12px] ${r.reason ? 'text-dim' : 'font-semibold'}`}>{how(r)}</span>
                  {others.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1 text-[11.5px] text-dim">
                      {t.alsoAt}
                      {others.slice(0, 3).map((h: CandleHit) => (
                        <button
                          key={h.time}
                          type="button"
                          onClick={() => setPicked((p) => ({ ...p, [r.tag]: h.time }))}
                          className="rounded-full bg-chip px-2 py-0.5 font-mono text-[11px] font-semibold text-ink hover:bg-panel"
                          title={t.how(t.point[h.point], tf, when(h.time))}
                        >
                          {when(h.time)}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="max-w-3xl text-xs text-dim">
            {t.tolerance(formatNumber(pair.matchPoints))} {t.sources(data?.futures.symbol ?? '', data?.futures.delayMinutes ?? 10)} {t.advice}
          </span>
          {copyText && (
            <Button variant="primary" onClick={copy}>
              {copied ? all.calculator.copied : t.copy(targetSymbol)}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Stable empty lists, so the chart does not redraw its overlays on every render. */
const NONE: never[] = [];
