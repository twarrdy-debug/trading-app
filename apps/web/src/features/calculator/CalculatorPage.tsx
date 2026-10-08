import {
  CFD_FUTURES_PAIRS,
  convertLevel,
  detectDirection,
  roundToStep,
  validatePriceSides,
  type BasisMethod,
  type CfdFuturesPair,
} from '@trading/shared';
import { useEffect, useState } from 'react';
import { useBasis, useInstruments, useRefreshBasis } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { currentLocale, formatAmount, formatMoney, formatNumber, formatPrice, parseDecimal } from '../../lib/format.ts';

// Every CFD ↔ futures pair (gold and the three US indices). Mini and micro futures quote the same
// price, so they are one side of the conversion; only the money per contract differs.

type Side = 'cfd' | 'futures';
type BasisMode = 'auto' | 'prices' | 'offset';

const PAIR_KEY = 'calc-pair';
/** Basis settings are kept per pair (gold kept its original key). */
const storageKey = (pair: CfdFuturesPair) => `calc-basis-${pair.key}`;

/** Placeholder prices until a measurement gives real ones. */
const EXAMPLES: Record<string, { cfd: string; futures: string; offset: string }> = {
  gold: { cfd: '4400', futures: '4435', offset: '35' },
  nasdaq: { cfd: '24000', futures: '24200', offset: '200' },
  sp500: { cfd: '6600', futures: '6650', offset: '50' },
  dow: { cfd: '46000', futures: '46300', offset: '300' },
};

function loadPair(): CfdFuturesPair {
  try {
    const key = localStorage.getItem(PAIR_KEY);
    return CFD_FUTURES_PAIRS.find((p) => p.key === key) ?? CFD_FUTURES_PAIRS.find((p) => p.key === 'gold')!;
  } catch {
    return CFD_FUTURES_PAIRS.find((p) => p.key === 'gold')!;
  }
}

interface StoredBasis {
  mode: BasisMode;
  cfd: string;
  futures: string;
  offset: string;
}

function loadStored(pair: CfdFuturesPair): Partial<StoredBasis> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(pair)) ?? '{}');
  } catch {
    return {};
  }
}

function store(pair: CfdFuturesPair, value: StoredBasis) {
  try {
    localStorage.setItem(storageKey(pair), JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode): the calculator still works for this visit.
  }
}

const shortTime = (iso: string) =>
  new Date(iso).toLocaleString(currentLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CalculatorPage() {
  const all = useT();
  const t = all.calculator;
  const language = useLanguage();
  const { data: instruments } = useInstruments();
  const basisData = useBasis();
  const refresh = useRefreshBasis();

  const [PAIR, setPair] = useState<CfdFuturesPair>(loadPair);
  /** "NQ1 / MNQ1": the futures side, one price for both contract sizes. */
  const FUT = `${PAIR.mini} / ${PAIR.micro}`;
  const SIDE_LABEL: Record<Side, string> = { cfd: `${PAIR.cfd} (CFD)`, futures: `${FUT} (Futures)` };
  const examples = EXAMPLES[PAIR.key] ?? EXAMPLES.gold!;

  const [basisMode, setBasisMode] = useState<BasisMode>('auto');
  const [cfdPrice, setCfdPrice] = useState('');
  const [futuresPrice, setFuturesPrice] = useState('');
  const [offsetText, setOffsetText] = useState('');
  const [method, setMethod] = useState<BasisMethod>('offset');

  const [priceSide, setPriceSide] = useState<Side>('cfd');
  const [priceInput, setPriceInput] = useState('');

  const [levelsSide, setLevelsSide] = useState<Side>('cfd');
  const [levels, setLevels] = useState({ entry: '', stopLoss: '', tp1: '', tp2: '' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stored = loadStored(PAIR);
    setBasisMode(stored.mode ?? 'auto');
    setCfdPrice(stored.cfd ?? '');
    setFuturesPrice(stored.futures ?? '');
    setOffsetText(stored.offset ?? '');
  }, [PAIR]);

  const choosePair = (key: string) => {
    const next = CFD_FUTURES_PAIRS.find((p) => p.key === key);
    if (!next) return;
    setPair(next);
    // Prices typed for one market mean nothing on another.
    setPriceInput('');
    setLevels({ entry: '', stopLoss: '', tp1: '', tp2: '' });
    try {
      localStorage.setItem(PAIR_KEY, next.key);
    } catch {
      // The choice resets to gold on the next visit.
    }
  };

  const updateBasis = (patch: Partial<StoredBasis>) => {
    const next = { mode: basisMode, cfd: cfdPrice, futures: futuresPrice, offset: offsetText, ...patch };
    setBasisMode(next.mode);
    setCfdPrice(next.cfd);
    setFuturesPrice(next.futures);
    setOffsetText(next.offset);
    store(PAIR, next);
  };

  const mini = instruments?.find((i) => i.symbol === PAIR.mini);
  const micro = instruments?.find((i) => i.symbol === PAIR.micro);
  const cfdInstrument = instruments?.find((i) => i.symbol === PAIR.cfd);
  /** Mini and micro share the tick (NQ/ES 0.25, YM 1, GC 0.1). */
  const tick = mini?.unitSize ?? 0.1;
  const contracts = [mini, micro].filter((i) => i != null);
  /** Distances read in the CFD's unit: pips for gold (0.1), points for the indices (1). */
  const distanceStep = cfdInstrument?.unitSize ?? 1;
  const distanceUnit = cfdInstrument ? all.units.short[cfdInstrument.measureUnit] : '';
  /** "$200 NQ1 · $20 MNQ1" for a price move on the futures (contracts are quoted in USD). */
  const perContracts = (move: number, sign = '') =>
    contracts.map((c) => t.tickValue(`${sign}${formatAmount((move / c.unitSize) * c.unitValue, c.quoteCurrency, false)}`, c.symbol)).join(' · ');

  const measured = basisData.data?.find((p) => p.pairKey === PAIR.key);
  const snapshot = measured?.latest ?? null;
  const cfd = parseDecimal(cfdPrice);
  const fut = parseDecimal(futuresPrice);
  const offset = parseDecimal(offsetText);
  const basis =
    basisMode === 'auto'
      ? snapshot && { cfdPrice: snapshot.cfdPrice, futuresPrice: snapshot.futuresPrice }
      : cfd && fut
        ? { cfdPrice: cfd, futuresPrice: fut }
        : null;
  const difference = basisMode === 'offset' ? offset : basis ? basis.futuresPrice - basis.cfdPrice : undefined;
  const ready = basisMode === 'offset' ? offset != null : basis != null;

  /** Converts a price to the other market: futures rounded to the tick, the CFD to 0.01. */
  const convertTo = (price: number, target: Side) => {
    const raw =
      basisMode === 'offset'
        ? price + (target === 'futures' ? offset! : -offset!)
        : convertLevel(price, basis!, target, method);
    return target === 'futures' ? roundToStep(raw, tick) : Math.round(raw * 100) / 100;
  };
  const other = (side: Side): Side => (side === 'cfd' ? 'futures' : 'cfd');

  // Single price.
  const priceNum = parseDecimal(priceInput);
  const priceOut = ready && priceNum != null ? convertTo(priceNum, other(priceSide)) : null;

  // Levels. BUY or SELL is read from the stop (above the entry = SELL), else from TP1.
  const entry = parseDecimal(levels.entry);
  const stopLoss = parseDecimal(levels.stopLoss);
  const tps = [parseDecimal(levels.tp1), parseDecimal(levels.tp2)];
  const direction = entry != null ? detectDirection(entry, stopLoss, tps) : null;
  const directionReason =
    entry == null || direction == null
      ? t.needLevels
      : stopLoss != null && stopLoss !== entry
        ? direction === 'short'
          ? t.reasonSlAbove
          : t.reasonSlBelow
        : direction === 'long'
          ? t.reasonTpAbove
          : t.reasonTpBelow;
  const sideWord = direction === 'long' ? 'BUY' : direction === 'short' ? 'SELL' : null;
  const warnings =
    entry != null && direction != null
      ? validatePriceSides(direction, entry, stopLoss, tps.filter((tp): tp is number => tp != null), language)
      : [];
  // Distances are measured on the futures prices (rounded to the tick), the same for both sides.
  const onFutures = (source: number) => (levelsSide === 'futures' ? source : convertTo(source, 'futures'));
  const entryFut = ready && entry != null ? onFutures(entry) : null;
  const slFut = ready && stopLoss != null ? onFutures(stopLoss) : null;
  const riskMove = entryFut != null && slFut != null ? Math.abs(entryFut - slFut) : null;

  const rows = [
    { label: 'IN', source: entry },
    { label: 'SL', source: stopLoss },
    { label: 'TP1', source: tps[0] },
    { label: 'TP2', source: tps[1] },
  ].filter((r): r is { label: string; source: number } => r.source != null);

  const target = other(levelsSide);
  const decimals = target === 'futures' ? (String(tick).split('.')[1] ?? '').length : 2;
  const copyText =
    ready && entry != null
      ? [
          `${target === 'futures' ? FUT : PAIR.cfd}${sideWord ? ` - ${sideWord}` : ''}`,
          ...rows.map((r) => `${r.label}: ${convertTo(r.source, target).toFixed(decimals)}`),
        ].join('\n')
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

  const setLevel = (key: keyof typeof levels) => (e: { target: { value: string } }) =>
    setLevels((l) => ({ ...l, [key]: e.target.value }));

  const sideOptions = [
    { value: 'cfd' as const, label: SIDE_LABEL.cfd },
    { value: 'futures' as const, label: SIDE_LABEL.futures },
  ];

  const levelTiles = [
    { key: 'entry' as const, label: t.entryIn, row: 'IN' },
    { key: 'stopLoss' as const, label: all.form.stopLoss, row: 'SL' },
    { key: 'tp1' as const, label: 'TP1', row: 'TP1' },
    { key: 'tp2' as const, label: 'TP2', row: 'TP2' },
  ];
  const targetSymbol = target === 'cfd' ? PAIR.cfd : FUT;
  const sourceSymbol = levelsSide === 'cfd' ? PAIR.cfd : FUT;
  const history = [...(measured?.history ?? [])].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));

  /** Swapping keeps the converted price, so the other market can be read back at once. */
  const swap = () => {
    setPriceSide(other(priceSide));
    setPriceInput(priceOut == null ? '' : String(priceOut));
  };

  return (
    <main className="page">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <div className="grow" />
        <Segmented
          label={t.pair}
          value={PAIR.key}
          onChange={choosePair}
          options={CFD_FUTURES_PAIRS.map((p) => ({ value: p.key, label: p.label[language] }))}
        />
      </div>
      <p className="m-0 -mt-2 font-mono text-sm text-dim">
        {PAIR.cfd} ↔ {FUT} · <span className="font-sans">{t.miniMicro}</span>
      </p>

      {/* The difference between the markets: the figure and its history on the left, how it is set on the right. */}
      <section aria-label={t.basisTitle(PAIR.mini, PAIR.cfd)} className="card grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 p-5 sm:p-6">
          <span className="eyebrow">{t.relative(FUT, PAIR.cfd)}</span>
          {difference != null ? (
            <span className="text-[40px] leading-none font-bold tracking-tight tabular-nums">
              {formatNumber(difference, true)}{' '}
              <span className="text-lg font-semibold text-dim">
                {t.points}
                {basis && basisMode !== 'offset' && ` · ${formatNumber((basis.futuresPrice / basis.cfdPrice - 1) * 100, true)}%`}
              </span>
            </span>
          ) : (
            <span className="text-sm text-dim">{basisMode === 'auto' ? t.noMeasurements : t.basisFirst}</span>
          )}
          {basisMode === 'auto' && measured?.alert ? (
            <p role="alert" className="m-0 rounded-(--radius-control) bg-sell-soft px-3 py-2.5 text-[13px] font-medium text-sell">
              {t.alert(formatNumber(measured.change, true), formatNumber(measured.alertPoints))}
            </p>
          ) : (
            basisMode === 'auto' &&
            measured?.change != null && <span className="font-mono text-xs text-dim">{t.change(formatNumber(measured.change, true), formatNumber(measured.alertPoints))}</span>
          )}
          {basisMode === 'auto' && history.length > 1 && (
            <div className="flex grow flex-col gap-1.5">
              <span className="eyebrow">{t.history}</span>
              <BasisSparkline values={history.map((h) => h.difference)} label={history.map((h) => `${shortTime(h.measuredAt)}: ${formatNumber(h.difference, true)} ${t.points}${h.live ? '' : t.closedMark}`).join(', ')} />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 border-t border-line p-5 sm:p-6 lg:border-t-0 lg:border-l">
          {basisMode === 'auto' && snapshot && (
            <div className="flex flex-col gap-1.5">
              <dl className="m-0 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 font-mono text-[13px]">
                <dt className="text-dim">{PAIR.cfd}</dt>
                <dd className="m-0 text-right font-semibold">{formatMoney(snapshot.cfdPrice, false)}</dd>
                <dd className="m-0 text-right text-dim">{shortTime(snapshot.cfdQuotedAt)}</dd>
                <dt className="text-dim">{FUT}</dt>
                <dd className="m-0 text-right font-semibold">{formatMoney(snapshot.futuresPrice, false)}</dd>
                <dd className="m-0 text-right text-dim">{shortTime(snapshot.futuresQuotedAt)}</dd>
              </dl>
              <span className={`text-xs ${snapshot.live ? 'text-dim' : 'font-medium text-accent-ink'}`}>
                {snapshot.live ? t.measuredAt(shortTime(snapshot.measuredAt), PAIR.cfd, t.reference[PAIR.key] ?? '') : t.marketClosed(PAIR.cfd, t.reference[PAIR.key] ?? '')}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="eyebrow">{t.source}</span>
            <div>
              <Segmented
                label={t.basisMode}
                value={basisMode}
                onChange={(mode) => updateBasis({ mode })}
                options={[
                  { value: 'auto', label: t.auto },
                  { value: 'prices', label: t.fromPrices },
                  { value: 'offset', label: t.manual },
                ]}
              />
            </div>
          </div>

          {basisMode === 'prices' && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-dim">{t.readBoth}</span>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t.priceNow(PAIR.cfd)}>
                  <Input inputMode="decimal" value={cfdPrice} onChange={(e) => updateBasis({ cfd: e.target.value })} placeholder={t.example(examples.cfd)} />
                </Field>
                <Field label={t.priceNow(PAIR.mini)}>
                  <Input inputMode="decimal" value={futuresPrice} onChange={(e) => updateBasis({ futures: e.target.value })} placeholder={t.example(examples.futures)} />
                </Field>
              </div>
            </div>
          )}

          {basisMode === 'offset' && (
            <Field label={t.offsetLabel(PAIR.mini, PAIR.cfd)} hint={t.offsetHint(PAIR.mini)}>
              <Input inputMode="decimal" value={offsetText} onChange={(e) => updateBasis({ offset: e.target.value })} placeholder={t.example(examples.offset)} />
            </Field>
          )}

          {basisMode !== 'offset' && (
            <div className="flex flex-col gap-2">
              <span className="eyebrow">{t.method}</span>
              <div>
                <Segmented
                  label={t.methodAria}
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'offset', label: t.methodOffset },
                    { value: 'ratio', label: t.methodRatio },
                  ]}
                />
              </div>
              <span className="text-xs text-dim">{method === 'offset' ? t.offsetInfo : t.ratioInfo}</span>
            </div>
          )}

          {basisMode === 'auto' && (
            <div className="mt-auto flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                {refresh.isPending ? t.checking : t.checkNow}
              </Button>
              <span className="text-xs text-dim">{t.autoInfo}</span>
              {refresh.data?.results
                .filter((r) => r.pairKey === PAIR.key && r.message)
                .map((r) => (
                  <span key={r.pairKey} className="w-full text-xs text-dim">
                    {r.message}
                  </span>
                ))}
            </div>
          )}
        </div>
      </section>

      {/* One price: the side being typed on the left, the other market on the right, swappable. */}
      <Panel title={t.priceTitle}>
        <div className="flex flex-col gap-3 px-5 pb-5">
          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <label className="flex min-w-0 flex-col gap-1 rounded-2xl border-[1.5px] border-accent bg-panel px-4 py-3">
              <span className="text-xs font-semibold text-dim">
                {priceSide === 'cfd' ? PAIR.cfd : FUT} · {t.side[priceSide]}
              </span>
              <input
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder={t.typePrice}
                aria-label={t.priceOf(priceSide === 'cfd' ? PAIR.cfd : FUT)}
                className="w-full border-0 bg-transparent p-0 font-mono text-[28px] font-bold text-ink outline-none placeholder:text-dim/60"
              />
            </label>
            <button
              type="button"
              onClick={swap}
              aria-label={t.swap}
              title={t.swap}
              className="flex size-11 items-center justify-center self-center justify-self-center rounded-full bg-accent text-lg font-bold text-on-accent shadow-(--shadow) transition hover:brightness-105 max-md:rotate-90"
            >
              ⇄
            </button>
            <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-raised px-4 py-3">
              <span className="text-xs font-semibold text-dim">
                {priceSide === 'cfd' ? FUT : PAIR.cfd} · {t.side[other(priceSide)]}
              </span>
              <output className="truncate font-mono text-[28px] font-bold" aria-live="polite">
                {priceOut == null ? '—' : formatPrice(priceOut)}
              </output>
            </div>
          </div>
          <span className="text-xs text-dim">{ready ? t.rounding(FUT, formatNumber(tick), perContracts(tick), PAIR.cfd, formatNumber(0.01)) : t.basisFirst}</span>
        </div>
      </Panel>

      {/* Levels: typed on one market, each tile shows the other market's price, distance and money. */}
      <section aria-label={t.levelsTitle} className="card flex flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3">
          <h2 className="m-0 text-[15px] font-bold">{t.levelsTitle}</h2>
          {sideWord && (
            <span title={directionReason} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${direction === 'long' ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'}`}>
              {sideWord}
            </span>
          )}
          <span className="text-[12.5px] text-dim">{sideWord ? directionReason : t.needLevels}</span>
          <div className="grow" />
          <Segmented label={t.levelsMarket} value={levelsSide} onChange={setLevelsSide} options={sideOptions} />
        </header>
        <div className="grid grid-cols-1 gap-2.5 px-5 sm:grid-cols-2 xl:grid-cols-4">
          {levelTiles.map((tile) => {
            const source = parseDecimal(levels[tile.key]);
            const out = ready && source != null ? convertTo(source, target) : null;
            const move = source != null && entryFut != null && tile.row !== 'IN' ? Math.abs(onFutures(source) - entryFut) : null;
            const isSl = tile.row === 'SL';
            const sign = isSl ? '−' : '+';
            const rr = tile.row.startsWith('TP') && riskMove && move != null ? t.rr(formatNumber(move / riskMove)) : null;
            const tone = tile.row === 'IN' ? 'bg-raised' : isSl ? 'bg-sell-soft' : 'bg-buy-soft';
            return (
              <div key={tile.key} className={`flex min-w-0 flex-col gap-2 rounded-2xl p-3.5 ${tone}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold">{tile.label}</span>
                  {move != null && (
                    <span className={`font-mono text-xs font-bold ${isSl ? 'text-sell' : 'text-buy'}`}>{t.distance(`${sign}${formatNumber(move / distanceStep)}`, distanceUnit)}</span>
                  )}
                </div>
                <Input inputMode="decimal" value={levels[tile.key]} onChange={setLevel(tile.key)} aria-label={`${tile.label} · ${sourceSymbol}`} placeholder={sourceSymbol} />
                <span className="truncate font-mono text-xl font-bold" aria-live="polite">
                  {out == null ? '—' : formatPrice(out)}
                </span>
                <span className="flex flex-col text-[11.5px] text-dim">
                  <span>{targetSymbol}</span>
                  {move != null && (
                    <span>
                      {perContracts(move, sign)}
                      {rr && ` · ${rr}`}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {warnings.length > 0 && (
          <ul className="m-0 mx-5 mt-3 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3 pb-5">
          <span className="text-xs text-dim">{t.levelsAs(sourceSymbol)}</span>
          {ready && entry != null && (
            <Button variant="primary" onClick={copy}>
              {copied ? t.copied : t.copy(targetSymbol)}
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

/** Line of the last measured differences, the latest marked; drawn to the card's width. */
function BasisSparkline({ values, label }: { values: number[]; label: string }) {
  const width = 400;
  const height = 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => [(i / (values.length - 1)) * (width - 8) + 4, height - 6 - ((v - min) / span) * (height - 12)] as const);
  const last = points[points.length - 1]!;
  return (
    // Grows with the card (at least 3.5 rem), so the line fills the space beside the settings.
    <div className="relative min-h-14 grow">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className="absolute inset-0 block size-full">
        <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The latest point as a dot outside the stretched drawing, so it stays round. */}
      <span aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${(last[0] / width) * 100}%`, top: `${(last[1] / height) * 100}%` }} />
    </div>
  );
}
