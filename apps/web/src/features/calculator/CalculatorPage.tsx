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
import { Stat } from '../../components/ui/Stat.tsx';
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

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Panel title={t.basisTitle(PAIR.mini, PAIR.cfd)} className="flex flex-col self-start">
          <div className="flex flex-col gap-4 p-5">
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

            {basisMode === 'auto' && (
              <div className="flex flex-col gap-3">
                {!snapshot ? (
                  <p className="m-0 text-[13px] text-dim">{t.noMeasurements}</p>
                ) : (
                  <>
                    <dl className="m-0 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 font-mono text-[13px]">
                      <dt className="text-dim">{PAIR.cfd}</dt>
                      <dd className="m-0 text-right">{formatMoney(snapshot.cfdPrice, false)}</dd>
                      <dd className="m-0 text-right text-dim">{shortTime(snapshot.cfdQuotedAt)}</dd>
                      <dt className="text-dim">{FUT}</dt>
                      <dd className="m-0 text-right">{formatMoney(snapshot.futuresPrice, false)}</dd>
                      <dd className="m-0 text-right text-dim">{shortTime(snapshot.futuresQuotedAt)}</dd>
                    </dl>
                    <span className={`text-xs ${snapshot.live ? 'text-dim' : 'text-accent-ink'}`}>
                      {snapshot.live
                        ? t.measuredAt(shortTime(snapshot.measuredAt), PAIR.cfd, t.reference[PAIR.key] ?? '')
                        : t.marketClosed(PAIR.cfd, t.reference[PAIR.key] ?? '')}
                    </span>
                    {measured?.alert ? (
                      <p role="alert" className="m-0 rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
                        {t.alert(formatNumber(measured.change, true), formatNumber(measured.alertPoints))}
                      </p>
                    ) : (
                      measured?.change != null && (
                        <span className="font-mono text-xs text-dim">
                          {t.change(formatNumber(measured.change, true), formatNumber(measured.alertPoints))}
                        </span>
                      )
                    )}
                    {measured && measured.history.length > 1 && (
                      <details className="text-[13px]">
                        <summary className="cursor-pointer text-dim">{t.history}</summary>
                        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 font-mono text-xs">
                          {measured.history.map((h) => (
                            <li key={h.id} className="flex justify-between gap-3">
                              <span className="text-dim">{shortTime(h.measuredAt)}</span>
                              <span>
                                {formatNumber(h.difference, true)} {t.points}
                                {h.live ? '' : t.closedMark}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
                <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                  {refresh.isPending ? t.checking : t.checkNow}
                </Button>
                {refresh.data?.results
                  .filter((r) => r.pairKey === PAIR.key && r.message)
                  .map((r) => (
                    <span key={r.pairKey} className="text-xs text-dim">
                      {r.message}
                    </span>
                  ))}
                <span className="text-xs text-dim">{t.autoInfo}</span>
              </div>
            )}

            {basisMode === 'prices' && (
              <>
                <p className="m-0 text-[13px] text-dim">{t.readBoth}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.priceNow(PAIR.cfd)}>
                    <Input inputMode="decimal" value={cfdPrice} onChange={(e) => updateBasis({ cfd: e.target.value })} placeholder={t.example(examples.cfd)} />
                  </Field>
                  <Field label={t.priceNow(PAIR.mini)}>
                    <Input inputMode="decimal" value={futuresPrice} onChange={(e) => updateBasis({ futures: e.target.value })} placeholder={t.example(examples.futures)} />
                  </Field>
                </div>
              </>
            )}

            {basisMode === 'offset' && (
              <Field label={t.offsetLabel(PAIR.mini, PAIR.cfd)} hint={t.offsetHint(PAIR.mini)}>
                <Input inputMode="decimal" value={offsetText} onChange={(e) => updateBasis({ offset: e.target.value })} placeholder={t.example(examples.offset)} />
              </Field>
            )}

            {difference != null && (
              <div className="flex items-baseline justify-between rounded-(--radius-control) bg-raised px-3.5 py-3 font-mono text-[13px]">
                <span className="text-dim">
                  {t.relative(PAIR.mini, PAIR.cfd)}
                </span>
                <span>
                  {formatNumber(difference, true)} {t.points}
                  {basis && basisMode !== 'offset' && ` · ${formatNumber((basis.futuresPrice / basis.cfdPrice - 1) * 100, true)}%`}
                </span>
              </div>
            )}

            {basisMode !== 'offset' && (
              <div className="flex flex-col gap-2">
                <span className="eyebrow">{t.method}</span>
                <Segmented
                  label={t.methodAria}
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'offset', label: t.methodOffset },
                    { value: 'ratio', label: t.methodRatio },
                  ]}
                />
                <span className="text-xs text-dim">
                  {method === 'offset' ? t.offsetInfo : t.ratioInfo}
                </span>
              </div>
            )}
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title={t.priceTitle} className="flex flex-col">
            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="eyebrow">{t.typingPrice}</span>
                <Segmented
                  label={t.priceInstrument}
                  value={priceSide}
                  onChange={(side) => {
                    setPriceSide(side);
                    setPriceInput('');
                  }}
                  options={sideOptions}
                />
              </div>
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <Field label={t.priceOf(priceSide === 'cfd' ? PAIR.cfd : FUT)}>
                  <Input
                    inputMode="decimal"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder={t.typePrice}
                    className="h-16 text-2xl"
                  />
                </Field>
                <span aria-hidden className="flex h-16 items-center justify-center px-2 text-2xl text-accent-ink">
                  →
                </span>
                <div className="flex min-h-16 flex-col justify-center gap-1 rounded-(--radius-control) bg-raised px-4 py-2">
                  <span className="eyebrow">{SIDE_LABEL[other(priceSide)]}</span>
                  <output className="font-mono text-2xl font-semibold" aria-live="polite">
                    {priceOut == null ? '—' : formatPrice(priceOut)}
                  </output>
                </div>
              </div>
              <span className="text-xs text-dim">
                {ready
                  ? t.rounding(FUT, formatNumber(tick), perContracts(tick), PAIR.cfd, formatNumber(0.01))
                  : t.basisFirst}
              </span>
            </div>
          </Panel>

          <Panel title={t.levelsTitle} className="flex flex-col">
            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="eyebrow">{t.levelsIn}</span>
                <Segmented label={t.levelsMarket} value={levelsSide} onChange={setLevelsSide} options={sideOptions} />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label={t.entryIn}>
                  <Input inputMode="decimal" value={levels.entry} onChange={setLevel('entry')} />
                </Field>
                <Field label={all.form.stopLoss}>
                  <Input inputMode="decimal" value={levels.stopLoss} onChange={setLevel('stopLoss')} />
                </Field>
                <Field label="TP1">
                  <Input inputMode="decimal" value={levels.tp1} onChange={setLevel('tp1')} />
                </Field>
                <Field label="TP2">
                  <Input inputMode="decimal" value={levels.tp2} onChange={setLevel('tp2')} />
                </Field>
              </div>
              {warnings.length > 0 && (
                <ul className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            {ready && entry != null && (
              <div className="flex justify-end px-5 pb-5">
                <Button variant="primary" onClick={copy}>
                  {copied ? t.copied : t.copy(target === 'cfd' ? PAIR.cfd : FUT)}
                </Button>
              </div>
            )}
          </Panel>

          {entry != null && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
              <Stat
                label={t.direction}
                value={sideWord ?? '—'}
                tone={direction === 'long' ? 'buy' : direction === 'short' ? 'sell' : 'ink'}
                foot={directionReason}
                visual={<DirectionMark direction={direction} />}
              />
              {ready &&
                rows.map((row) => {
                  const move = entryFut != null && row.label !== 'IN' ? Math.abs(onFutures(row.source) - entryFut) : null;
                  const isSl = row.label === 'SL';
                  const sign = isSl ? '−' : '+';
                  const targetSymbol = target === 'cfd' ? PAIR.cfd : FUT;
                  const sourceSymbol = levelsSide === 'cfd' ? PAIR.cfd : FUT;
                  const rr = row.label.startsWith('TP') && riskMove && move != null ? t.rr(formatNumber(move / riskMove)) : null;
                  return (
                    <Stat
                      key={row.label}
                      label={t.levelTile(row.label, targetSymbol)}
                      value={formatPrice(convertTo(row.source, target))}
                      tone={row.label === 'IN' ? 'ink' : isSl ? 'sell' : 'buy'}
                      foot={
                        <span className="flex flex-col">
                          <span>{t.fromSource(sourceSymbol, formatPrice(row.source))}</span>
                          {move != null && (
                            <>
                              <span>
                                {t.distance(`${sign}${formatNumber(move / distanceStep)}`, distanceUnit)}
                                {rr && ` · ${rr}`}
                              </span>
                              <span>{t.perContract(perContracts(move, sign))}</span>
                            </>
                          )}
                        </span>
                      }
                    />
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/** Round badge with an up (BUY) or down (SELL) arrow, the visual of the direction tile. */
function DirectionMark({ direction }: { direction: 'long' | 'short' | null }) {
  const tone = direction === 'long' ? 'bg-buy-soft text-buy' : direction === 'short' ? 'bg-sell-soft text-sell' : 'bg-chip text-dim';
  return (
    <span aria-hidden className={`flex size-15 shrink-0 items-center justify-center rounded-full ${tone}`}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {direction === 'short' ? <path d="M12 5v14M5 12l7 7 7-7" /> : direction === 'long' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M6 12h12" />}
      </svg>
    </span>
  );
}
