import { CFD_FUTURES_PAIRS, convertLevel, detectDirection, roundToStep, validatePriceSides, type BasisMethod } from '@trading/shared';
import { useEffect, useState } from 'react';
import { useBasis, useInstruments, useRefreshBasis } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Stat } from '../../components/ui/Stat.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { currentLocale, formatMoney, formatNumber, formatPrice, parseDecimal } from '../../lib/format.ts';

/** The calculator covers gold only: XAUUSD (CFD) ↔ GC1 (futures). */
const PAIR = CFD_FUTURES_PAIRS.find((p) => p.key === 'gold')!;

type Side = 'cfd' | 'futures';
type BasisMode = 'auto' | 'prices' | 'offset';

const STORAGE_KEY = 'calc-basis-gold';

interface StoredBasis {
  mode: BasisMode;
  cfd: string;
  futures: string;
  offset: string;
}

function loadStored(): Partial<StoredBasis> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function store(value: StoredBasis) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode): the calculator still works for this visit.
  }
}

const shortTime = (iso: string) =>
  new Date(iso).toLocaleString(currentLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const SIDE_LABEL: Record<Side, string> = { cfd: `${PAIR.cfd} (CFD)`, futures: `${PAIR.mini} (Futures)` };

export function CalculatorPage() {
  const all = useT();
  const t = all.calculator;
  const language = useLanguage();
  const { data: instruments } = useInstruments();
  const basisData = useBasis();
  const refresh = useRefreshBasis();

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
    const stored = loadStored();
    setBasisMode(stored.mode ?? 'auto');
    setCfdPrice(stored.cfd ?? '');
    setFuturesPrice(stored.futures ?? '');
    setOffsetText(stored.offset ?? '');
  }, []);

  const updateBasis = (patch: Partial<StoredBasis>) => {
    const next = { mode: basisMode, cfd: cfdPrice, futures: futuresPrice, offset: offsetText, ...patch };
    setBasisMode(next.mode);
    setCfdPrice(next.cfd);
    setFuturesPrice(next.futures);
    setOffsetText(next.offset);
    store(next);
  };

  const gc = instruments?.find((i) => i.symbol === PAIR.mini);
  const tick = gc?.unitSize ?? 0.1;
  const tickValue = gc?.unitValue ?? 10;

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

  /** Converts a price to the other market: GC1 rounded to the tick, XAUUSD to 0.01. */
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
  const onGc = (source: number) => (levelsSide === 'futures' ? source : convertTo(source, 'futures'));
  const entryGc = ready && entry != null ? onGc(entry) : null;
  const slGc = ready && stopLoss != null ? onGc(stopLoss) : null;
  const riskTicks = entryGc != null && slGc != null ? Math.abs(entryGc - slGc) / tick : null;

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
          `${target === 'futures' ? PAIR.mini : PAIR.cfd}${sideWord ? ` - ${sideWord}` : ''}`,
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
      <h1 className="m-0 text-2xl font-bold tracking-tight">
        {t.title(PAIR.cfd, PAIR.mini)}
      </h1>

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
                      <dt className="text-dim">{PAIR.mini}</dt>
                      <dd className="m-0 text-right">{formatMoney(snapshot.futuresPrice, false)}</dd>
                      <dd className="m-0 text-right text-dim">{shortTime(snapshot.futuresQuotedAt)}</dd>
                    </dl>
                    <span className={`text-xs ${snapshot.live ? 'text-dim' : 'text-accent-ink'}`}>
                      {snapshot.live
                        ? t.measuredAt(shortTime(snapshot.measuredAt), PAIR.cfd)
                        : t.marketClosed(PAIR.cfd)}
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
                    <Input inputMode="decimal" value={cfdPrice} onChange={(e) => updateBasis({ cfd: e.target.value })} placeholder={t.example('4400')} />
                  </Field>
                  <Field label={t.priceNow(PAIR.mini)}>
                    <Input inputMode="decimal" value={futuresPrice} onChange={(e) => updateBasis({ futures: e.target.value })} placeholder={t.example('4435')} />
                  </Field>
                </div>
              </>
            )}

            {basisMode === 'offset' && (
              <Field label={t.offsetLabel(PAIR.mini, PAIR.cfd)} hint={t.offsetHint(PAIR.mini)}>
                <Input inputMode="decimal" value={offsetText} onChange={(e) => updateBasis({ offset: e.target.value })} placeholder={t.example('35')} />
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
                <Field label={t.priceOf(priceSide === 'cfd' ? PAIR.cfd : PAIR.mini)}>
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
                  ? t.rounding(PAIR.mini, formatNumber(tick), formatMoney(tickValue, false), PAIR.cfd, formatNumber(0.01))
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
                  {copied ? t.copied : t.copy(target === 'cfd' ? PAIR.cfd : PAIR.mini)}
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
                  const ticks = entryGc != null && row.label !== 'IN' ? Math.abs(onGc(row.source) - entryGc) / tick : null;
                  const isSl = row.label === 'SL';
                  const sign = isSl ? '−' : '+';
                  const targetSymbol = target === 'cfd' ? PAIR.cfd : PAIR.mini;
                  const sourceSymbol = levelsSide === 'cfd' ? PAIR.cfd : PAIR.mini;
                  const rr = row.label.startsWith('TP') && riskTicks && ticks != null ? t.rr(formatNumber(ticks / riskTicks)) : null;
                  return (
                    <Stat
                      key={row.label}
                      label={t.levelTile(row.label, targetSymbol)}
                      value={formatPrice(convertTo(row.source, target))}
                      tone={row.label === 'IN' ? 'ink' : isSl ? 'sell' : 'buy'}
                      foot={
                        <span className="flex flex-col">
                          <span>{t.fromSource(sourceSymbol, formatPrice(row.source))}</span>
                          {ticks != null && (
                            <span>
                              {t.pips(ticks, `${sign}${formatNumber(ticks)}`)} · {t.perContract1(`${sign}${formatMoney(ticks * tickValue, false)}`)}
                              {rr && ` · ${rr}`}
                            </span>
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
