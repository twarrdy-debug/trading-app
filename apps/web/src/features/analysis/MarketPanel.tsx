import type { MarketAnalysis } from '@trading/api/types';
import {
  ANALYSIS_RESOLUTIONS,
  analysisSource,
  ema,
  findFvgs,
  findStructure,
  macd,
  premiumDiscount,
  rsi,
  sessionLevels,
  type AnalysisResolution,
} from '@trading/shared';
import { useEffect, useMemo, useState } from 'react';
import { useInstruments, useMarketAnalysis, useMe } from '../../api/hooks.ts';
import { TradingChart, type ChartBox, type ChartLine, type ChartLineSeries, type ChartPane, type ChartSegment } from '../../components/charts/TradingChart.tsx';
import { Chip, Input, Segmented } from '../../components/ui/Field.tsx';
import { InstrumentLogo } from '../../components/ui/InstrumentBadge.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale, formatNumber } from '../../lib/format.ts';
import { instrumentOptions } from '../../lib/instruments.ts';

const INSTRUMENT_KEY = 'analysis-instrument';
const RESOLUTION_KEY = 'analysis-resolution';
const SETTINGS_KEY = 'analysis-indicators';

type ToggleKey = 'rsi' | 'macd' | 'fvg' | 'ob' | 'structure' | 'equal' | 'premium' | 'dayLevels' | 'opens' | 'sessions' | 'ema';

interface Settings {
  emas: number[];
  on: Record<ToggleKey, boolean>;
  /** BOS/CHoCH: the latest break each way (default) or the last six. */
  structureHistory: boolean;
}

/** The owner's defaults (2026-10-13): SMC zones, EMA 200/233, RSI and MACD on. */
const DEFAULT_SETTINGS: Settings = {
  emas: [200, 233],
  on: { ema: true, rsi: true, macd: true, fvg: true, ob: true, structure: true, equal: true, premium: true, dayLevels: true, opens: false, sessions: false },
  structureHistory: false,
};

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice just resets on the next visit.
  }
};
const loadSettings = (): Settings => {
  try {
    const saved = JSON.parse(read(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return { emas: saved.emas?.length ? saved.emas : DEFAULT_SETTINGS.emas, on: { ...DEFAULT_SETTINGS.on, ...saved.on }, structureHistory: saved.structureHistory ?? false };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** Decimals a price is shown with: one more than the pip/tick/point (EURUSD 5, gold 2, indices 1). */
const decimalsFor = (unitSize: number) => Math.min(5, Math.max(1, Math.ceil(-Math.log10(unitSize)) + 1));
const STRENGTH: Record<AnalysisResolution, number> = { M5: 3, M15: 3, H1: 3, H4: 2, D1: 2 };
const EMA_COLORS = ['chart-ema-1', 'chart-ema-2', 'chart-ema-3', 'chart-ema-4'];
const INTRADAY: AnalysisResolution[] = ['M5', 'M15', 'H1'];

type Level = { tag: string; tone: 'eqh' | 'eql' | 'day' | 'swing'; price: number; note: string };

const TAG_TONE: Record<Level['tone'], string> = {
  eqh: 'bg-sell-soft text-sell',
  eql: 'bg-buy-soft text-buy',
  day: 'bg-accent/15 text-accent-ink',
  swing: 'bg-chip text-dim',
};

/** Levels to list: open equal highs/lows, day/week/month levels and unbroken swings; near duplicates once. */
function levelsOf(a: MarketAnalysis, t: ReturnType<typeof useT>['analysis']): Level[] {
  const d = a.dayLevels;
  const list: Level[] = [
    ...a.equalLevels
      .filter((l) => !l.swept)
      .map((l) => ({ tag: l.kind === 'highs' ? 'EQH' : 'EQL', tone: l.kind === 'highs' ? ('eqh' as const) : ('eql' as const), price: l.price, note: t.touched(l.touches.length) })),
    ...(
      [
        ['PDH', d.pdh, t.prevDay],
        ['PDL', d.pdl, t.prevDay],
        ['PWH', d.pwh, t.prevWeek],
        ['PWL', d.pwl, t.prevWeek],
        ['PMH', d.pmh, t.prevMonth],
        ['PML', d.pml, t.prevMonth],
        ['DO', d.todayOpen, t.dayOpen],
        ['WO', d.weekOpen, t.weekOpen],
        ['MO', d.monthOpen, t.monthOpen],
      ] as const
    )
      .filter(([, price]) => price != null)
      .map(([tag, price, note]) => ({ tag, tone: 'day' as const, price: price!, note })),
    ...a.swings.filter((s) => !s.broken).map((s) => ({ tag: s.kind === 'high' ? 'SH' : 'SL', tone: 'swing' as const, price: s.price, note: t.swing })),
  ];
  const near = (a.atr ?? 0) * 0.05;
  return list.filter((l, i) => l.tone !== 'swing' || !list.some((o, j) => j !== i && o.tone !== 'swing' && Math.abs(o.price - l.price) <= near));
}

/**
 * "Market": the automatic analysis of one instrument on a TradingView-style chart (the owner chose
 * TradingView colours, 2026-10-13): EMAs, RSI and MACD panes, smart-money zones (FVG, order blocks,
 * BOS/CHoCH, equal highs/lows, premium/discount), day/week/month levels and session ranges, each
 * switched on or off per browser; client sentiment, latest values and the nearest levels on the side.
 * Never investment advice.
 */
export function MarketPanel() {
  const all = useT();
  const t = all.analysis;
  const { data: instruments } = useInstruments();
  const { data: me } = useMe();
  const timezone = me?.settings.timezone ?? 'Europe/Warsaw';

  const choices = (instruments ?? []).filter((i) => i.active !== false && analysisSource(i.symbol)).sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const [instrumentId, setInstrumentId] = useState<string | null>(read(INSTRUMENT_KEY));
  const [resolution, setResolution] = useState<AnalysisResolution>(() =>
    (ANALYSIS_RESOLUTIONS as readonly string[]).includes(read(RESOLUTION_KEY) ?? '') ? (read(RESOLUTION_KEY) as AnalysisResolution) : 'H1',
  );
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [emaText, setEmaText] = useState(settings.emas.join(', '));
  const selected = choices.find((i) => i.id === instrumentId) ?? choices[0] ?? null;
  useEffect(() => {
    if (selected && selected.id !== instrumentId) setInstrumentId(selected.id);
  }, [selected, instrumentId]);
  useEffect(() => write(SETTINGS_KEY, JSON.stringify(settings)), [settings]);

  const { data: a, isPending } = useMarketAnalysis(selected?.id ?? null, resolution);
  const choose = (id: string) => {
    setInstrumentId(id);
    write(INSTRUMENT_KEY, id);
  };
  const chooseResolution = (r: AnalysisResolution) => {
    setResolution(r);
    write(RESOLUTION_KEY, r);
  };
  const toggle = (key: ToggleKey) => setSettings((s) => ({ ...s, on: { ...s.on, [key]: !s.on[key] } }));
  const saveEmas = () => {
    const periods = [...new Set(emaText.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 2 && n <= 500))].slice(0, 4);
    setSettings((s) => ({ ...s, emas: periods.length ? periods : DEFAULT_SETTINGS.emas }));
    setEmaText((periods.length ? periods : DEFAULT_SETTINGS.emas).join(', '));
  };

  const decimals = a ? decimalsFor(a.instrument.unitSize) : 2;
  const unit = a ? all.units.short[a.instrument.measureUnit] : '';
  const price = (p: number) => p.toLocaleString(currentLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const on = settings.on;

  // Everything the chart draws, recomputed only when the data or the switches change.
  const chart = useMemo(() => {
    if (!a || a.candles.length === 0) return null;
    const candles = a.candles;
    const closes = candles.map((c) => c.close);
    const atr = a.atr ?? 0;
    const overlays: ChartLineSeries[] = on.ema
      ? settings.emas.map((period, i) => ({ key: `ema${period}`, label: `EMA ${period}`, color: EMA_COLORS[i % EMA_COLORS.length]!, values: ema(closes, period), width: 1 }))
      : [];
    const panes: ChartPane[] = [];
    const rsiValues = rsi(closes);
    const macdValues = macd(closes);
    if (on.rsi) panes.push({ key: 'rsi', lines: [{ key: 'rsi', label: 'RSI 14', color: 'chart-ema-1', values: rsiValues }], levels: [70, 30] });
    if (on.macd)
      panes.push({
        key: 'macd',
        histogram: macdValues.histogram,
        lines: [
          { key: 'macd', label: 'MACD', color: 'chart-accent', values: macdValues.line },
          { key: 'signal', label: 'Signal', color: 'chart-level', values: macdValues.signal },
        ],
      });

    const boxes: ChartBox[] = [];
    // Zones still standing and within 4 ATR of the price: farther ones do not matter for the session.
    const last = closes.at(-1)!;
    const near = (top: number, bottom: number) => !atr || Math.abs((top + bottom) / 2 - last) <= atr * 4;
    const standing = <T extends { endedAt: string | null; top: number; bottom: number }>(list: T[], n: number) =>
      list.filter((z) => z.endedAt == null && near(z.top, z.bottom)).slice(-n);
    if (on.premium) {
      const pd = premiumDiscount(candles);
      if (pd) {
        boxes.push({ from: pd.from, to: null, top: pd.premium.top, bottom: pd.premium.bottom, color: 'chart-down', fill: 0.08, label: 'Premium' });
        boxes.push({ from: pd.from, to: null, top: pd.equilibrium.top, bottom: pd.equilibrium.bottom, color: 'chart-text', fill: 0.05, label: 'EQ', dashed: true });
        boxes.push({ from: pd.from, to: null, top: pd.discount.top, bottom: pd.discount.bottom, color: 'chart-up', fill: 0.08, label: 'Discount' });
      }
    }
    if (on.sessions && INTRADAY.includes(resolution)) {
      for (const s of sessionLevels(candles, 2))
        boxes.push({ from: s.start, to: s.open ? null : s.end, top: s.high, bottom: s.low, color: `chart-${s.session}`, fill: 0.05, label: t.sessionNames[s.session], dashed: true, labelAt: 'above' });
    }
    if (on.fvg) for (const z of standing(findFvgs(candles, atr * 0.15), 6)) boxes.push({ from: z.time, to: null, top: z.top, bottom: z.bottom, color: 'chart-fvg', label: z.direction === 'bull' ? 'FVG ↑' : 'FVG ↓' });
    const structure = findStructure(candles, STRENGTH[resolution]);
    if (on.ob)
      for (const z of standing(structure.orderBlocks, 4))
        boxes.push({ from: z.time, to: null, top: z.top, bottom: z.bottom, color: z.direction === 'bull' ? 'chart-accent' : 'chart-down', label: z.direction === 'bull' ? 'OB ↑' : 'OB ↓' });
    if (on.equal)
      for (const l of a.equalLevels.filter((x) => !x.swept && near(x.top, x.bottom)).slice(-4))
        boxes.push({ from: l.touches[0]!.time, to: null, top: l.top + atr * 0.02, bottom: l.bottom - atr * 0.02, color: l.kind === 'highs' ? 'chart-down' : 'chart-up', fill: 0.12, label: l.kind === 'highs' ? 'EQH' : 'EQL' });
    // Current structure: the latest bullish and the latest bearish break; history: the last six.
    const shownBreaks = settings.structureHistory
      ? structure.breaks.slice(-6)
      : (['bull', 'bear'] as const).map((d) => structure.breaks.filter((b) => b.direction === d).at(-1)).filter((b) => b != null);
    const segments: ChartSegment[] = on.structure
      ? shownBreaks.map((b) => ({ from: b.from, to: b.to, price: b.price, color: b.direction === 'bull' ? 'chart-up' : 'chart-down', label: b.kind === 'bos' ? 'BOS' : 'CHoCH', above: b.direction === 'bull' }))
      : [];

    const d = a.dayLevels;
    const lines: ChartLine[] = [
      ...(on.dayLevels
        ? ([['PDH', d.pdh], ['PDL', d.pdl], ['PWH', d.pwh], ['PWL', d.pwl]] as const).filter(([, p]) => p != null).map(([label, p]) => ({ label, price: p!, color: 'chart-level' }))
        : []),
      ...(on.opens
        ? ([['DO', d.todayOpen], ['WO', d.weekOpen], ['MO', d.monthOpen], ['PMH', d.pmh], ['PML', d.pml]] as const)
            .filter(([, p]) => p != null)
            .map(([label, p]) => ({ label, price: p!, color: 'chart-ema-3' }))
        : []),
    ];
    const lastOf = (values: (number | null)[]) => values.at(-1) ?? null;
    return {
      candles,
      overlays,
      panes,
      boxes,
      segments,
      lines,
      readout: {
        rsi: lastOf(rsiValues),
        macd: lastOf(macdValues.line),
        signal: lastOf(macdValues.signal),
        emas: overlays.map((o) => ({ label: o.label, value: lastOf(o.values) })),
      },
    };
  }, [a, settings, resolution, t, on]);

  const toggleGroups: { label: string; keys: ToggleKey[] }[] = [
    { label: t.groupIndicators, keys: ['ema', 'rsi', 'macd'] },
    { label: t.groupZones, keys: ['fvg', 'ob', 'structure', 'equal', 'premium'] },
    { label: t.groupLevels, keys: ['dayLevels', 'opens', 'sessions'] },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="flex items-start gap-2.5 rounded-(--radius-control) bg-warn-bg px-4 py-3 text-[13px]">
        <span aria-hidden className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-warn text-[11px] font-extrabold text-panel">
          !
        </span>
        <span>
          <b className="text-warn">{t.disclaimerTitle}</b> {t.disclaimer}
        </span>
      </div>

      {choices.length === 0 ? (
        <p className="card m-0 p-6 text-sm text-dim">{t.noInstruments}</p>
      ) : (
        <>
          <section className="card flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Favourites as one-click chips; every instrument with data in the list. */}
              <div role="group" aria-label={t.instrument} className="flex flex-wrap gap-1.5">
                {choices
                  .filter((i) => i.favorite)
                  .slice(0, 8)
                  .map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      aria-pressed={i.id === selected?.id}
                      onClick={() => choose(i.id)}
                      className={`inline-flex h-9 items-center gap-2 rounded-full border pr-3 pl-1 text-[13px] font-semibold transition ${
                        i.id === selected?.id ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-panel text-dim hover:text-ink'
                      }`}
                    >
                      <InstrumentLogo symbol={i.symbol} size={24} />
                      {i.symbol}
                    </button>
                  ))}
              </div>
              <div className="w-full sm:w-60">
                <Select
                  aria-label={t.instrument}
                  value={selected?.id ?? ''}
                  onChange={choose}
                  options={instrumentOptions(choices, { label: (i) => `${i.symbol} · ${i.name}`, favorites: all.instruments.favorites, others: all.instruments.others })}
                />
              </div>
              <div className="grow" />
              <Segmented label={t.resolution} value={resolution} onChange={chooseResolution} options={ANALYSIS_RESOLUTIONS.map((r) => ({ value: r, label: r }))} />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3">
              {toggleGroups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label} className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs font-semibold text-dim">{group.label}</span>
                  {group.keys.map((key) => (
                    <Chip key={key} active={on[key]} onClick={() => toggle(key)}>
                      {t.toggles[key]}
                    </Chip>
                  ))}
                  {group.keys.includes('structure') && on.structure && (
                    <Chip active={settings.structureHistory} onClick={() => setSettings((s) => ({ ...s, structureHistory: !s.structureHistory }))} label={t.structureHistoryHelp}>
                      {t.structureHistory}
                    </Chip>
                  )}
                  {group.keys.includes('ema') && on.ema && (
                    <Input
                      aria-label={t.emaPeriods}
                      title={t.emaPeriods}
                      value={emaText}
                      onChange={(e) => setEmaText(e.target.value)}
                      onBlur={saveEmas}
                      onKeyDown={(e) => e.key === 'Enter' && saveEmas()}
                      placeholder={t.emaPeriodsHint}
                      className="h-8! w-28! text-xs"
                    />
                  )}
                </div>
              ))}
            </div>
            {on.sessions && !INTRADAY.includes(resolution) && <span className="text-xs text-dim">{t.sessionsIntraday}</span>}
          </section>

          {a && !a.available ? (
            <p className="card m-0 p-6 text-sm text-dim">{t.unavailable}</p>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <section
                aria-label={a ? t.chartAria(a.instrument.symbol, resolution) : t.instrument}
                className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-(--radius) p-3 shadow-(--shadow)"
                style={{ background: 'var(--chart-bg)', color: 'var(--chart-text)' }}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                  <span className="text-[15px] font-bold">{selected?.symbol}</span>
                  <span className="text-[12.5px] opacity-70">
                    {selected?.name} · {resolution}
                  </span>
                  <div className="grow" />
                  {a?.lastPrice != null && <span className="font-mono text-xs opacity-70">{t.lastPrice(price(a.lastPrice))}</span>}
                </div>
                {a?.source.via && (
                  <span className="px-1 text-xs opacity-70">
                    {a.offset
                      ? t.via(
                          a.source.via,
                          `${a.offset.difference >= 0 ? '+' : '−'}${formatNumber(Math.abs(a.offset.difference))}`,
                          new Date(a.offset.measuredAt).toLocaleString(currentLocale(), { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                        )
                      : t.viaUnmeasured(a.source.via)}
                  </span>
                )}
                {a?.fetchError && <span className="px-1 text-xs text-warn">{t.stale}</span>}
                {isPending && !a ? (
                  <div className="h-[clamp(520px,74vh,920px)] animate-pulse rounded-xl opacity-30" style={{ background: 'var(--chart-grid)' }} />
                ) : chart ? (
                  <TradingChart
                    candles={chart.candles}
                    overlays={chart.overlays}
                    boxes={chart.boxes}
                    segments={chart.segments}
                    lines={chart.lines}
                    panes={chart.panes}
                    decimals={decimals}
                    timeZone={timezone}
                    resetKey={`${selected?.id}:${resolution}:${chart.panes.map((p) => p.key).join(',')}`}
                    ariaLabel={t.chartAria(selected?.symbol ?? '', resolution)}
                    watermark={`${selected?.symbol ?? ''} · ${resolution}`}
                  />
                ) : (
                  <p className="m-0 py-16 text-center text-sm opacity-70">{t.noData}</p>
                )}
              </section>

              <div className="flex flex-col gap-4">
                <section aria-label={t.sentimentTitle} className="card flex flex-col gap-2 px-4 py-3.5">
                  <span className="eyebrow">{t.sentimentTitle}</span>
                  {a?.sentiment ? (
                    <>
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-buy">{t.buyers(formatNumber(Math.round(a.sentiment.long)))}</span>
                        <span className="text-sell">{t.sellers(formatNumber(Math.round(a.sentiment.short)))}</span>
                      </div>
                      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                        <span className="bg-buy" style={{ width: `${a.sentiment.long}%` }} />
                        <span className="bg-sell" style={{ width: `${a.sentiment.short}%` }} />
                      </div>
                      <span className="text-[11.5px] text-dim">{t.sentimentHelp}</span>
                    </>
                  ) : (
                    <span className="text-[13px] text-dim">{t.noSentiment}</span>
                  )}
                </section>

                {a && chart && (
                  <section aria-label={t.readout} className="card flex flex-col gap-2 px-4 py-3.5">
                    <span className="eyebrow">{t.readout}</span>
                    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                      <dt className="text-dim">{t.atrTitle(resolution)}</dt>
                      <dd className="m-0 text-right font-mono font-semibold">
                        {a.atr != null ? `${formatNumber(Math.round((a.atr / a.instrument.unitSize) * 10) / 10)} ${unit}` : '—'}
                      </dd>
                      <dt className="text-dim">RSI 14</dt>
                      <dd
                        className={`m-0 text-right font-mono font-semibold ${
                          chart.readout.rsi != null && chart.readout.rsi >= 70 ? 'text-sell' : chart.readout.rsi != null && chart.readout.rsi <= 30 ? 'text-buy' : ''
                        }`}
                      >
                        {chart.readout.rsi != null ? formatNumber(Math.round(chart.readout.rsi * 10) / 10) : '—'}
                      </dd>
                      <dt className="text-dim">MACD</dt>
                      <dd className="m-0 text-right font-mono font-semibold">
                        {chart.readout.macd != null ? price(chart.readout.macd) : '—'} / {chart.readout.signal != null ? price(chart.readout.signal) : '—'}
                      </dd>
                      {chart.readout.emas.map((e) => (
                        <div key={e.label} className="contents">
                          <dt className="text-dim">{e.label}</dt>
                          <dd className="m-0 text-right font-mono font-semibold">{e.value != null ? price(e.value) : '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}

                {a && a.lastPrice != null && a.atr != null && <LevelList analysis={a} price={price} unit={unit} />}
                <Glossary />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const GLOSSARY_KEY = 'analysis-glossary-open';

/** Short explanations of the zones and levels on the chart; open until folded (remembered per browser). */
function Glossary() {
  const t = useT().analysis;
  const [open] = useState(() => {
    try {
      return localStorage.getItem(GLOSSARY_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  return (
    <details
      open={open}
      onToggle={(e) => {
        try {
          localStorage.setItem(GLOSSARY_KEY, String(e.currentTarget.open));
        } catch {
          // Not remembered.
        }
      }}
      className="card group px-4 py-3.5"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
        {t.glossaryTitle}
        <span aria-hidden className="text-dim transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <dl className="m-0 mt-3 flex flex-col gap-2.5">
        {t.glossary.map(([tag, name, text]) => (
          <div key={tag} className="flex flex-col gap-0.5">
            <dt className="flex items-baseline gap-2 text-[13px]">
              <span className="rounded-md bg-chip px-1.5 py-0.5 text-[10.5px] font-extrabold">{tag}</span>
              <span className="font-semibold">{name}</span>
            </dt>
            <dd className="m-0 text-xs leading-snug text-dim">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-3 text-[11.5px] text-dim">{t.glossaryNote}</p>
    </details>
  );
}

function LevelList({ analysis: a, price, unit }: { analysis: MarketAnalysis; price: (p: number) => string; unit: string }) {
  const t = useT().analysis;
  const last = a.lastPrice!;
  const atr = a.atr!;
  const levels = levelsOf(a, t);
  const above = levels.filter((l) => l.price > last).sort((x, y) => x.price - y.price).slice(0, 5).reverse();
  const below = levels.filter((l) => l.price <= last).sort((x, y) => y.price - x.price).slice(0, 5);
  const row = (l: Level) => {
    const distance = Math.abs(l.price - last);
    return (
      <li key={`${l.tag}${l.price}`} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 px-4 py-1.5 text-[13px]">
        <span className={`rounded-md px-1.5 py-0.5 text-center text-[10.5px] font-extrabold ${TAG_TONE[l.tone]}`}>{l.tag}</span>
        <span className="min-w-0 truncate">
          <span className="font-mono font-bold">{price(l.price)}</span> <span className="text-[11.5px] text-dim">{l.note}</span>
        </span>
        <span className="text-right font-mono text-[11px] leading-tight text-dim">
          {l.price > last ? '+' : '−'}
          {formatNumber(Math.round((distance / a.instrument.unitSize) * 10) / 10)} {unit}
          <br />
          {formatNumber(Math.round((distance / atr) * 10) / 10)} ATR
        </span>
      </li>
    );
  };
  return (
    <section className="card flex flex-col py-2" aria-label={`${t.above} / ${t.below}`}>
      {above.length + below.length === 0 && <p className="m-0 px-4 py-3 text-[13px] text-dim">{t.noLevels}</p>}
      {above.length > 0 && (
        <>
          <span className="px-4 pt-1.5 pb-0.5 text-[11.5px] font-bold text-dim">{t.above}</span>
          <ul className="m-0 list-none p-0">{above.map(row)}</ul>
        </>
      )}
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-extrabold text-accent-ink">
        {t.priceRow(price(last))}
        <span aria-hidden className="h-0.5 grow rounded-full bg-accent" />
      </div>
      {below.length > 0 && (
        <>
          <span className="px-4 pt-1 pb-0.5 text-[11.5px] font-bold text-dim">{t.below}</span>
          <ul className="m-0 list-none p-0">{below.map(row)}</ul>
        </>
      )}
    </section>
  );
}
