import { CFD_FUTURES_PAIRS, convertLevel, roundToStep, validatePriceSides, type BasisMethod } from '@trading/shared';
import { useEffect, useState } from 'react';
import { useBasis, useInstruments, useRefreshBasis } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { formatMoney, formatNumber, formatPrice, parseDecimal } from '../../lib/format.ts';

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
  new Date(iso).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const SIDE_LABEL: Record<Side, string> = { cfd: `${PAIR.cfd} (CFD)`, futures: `${PAIR.mini} (Futures)` };

export function CalculatorPage() {
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

  // Levels. Direction follows from the stop: above the entry means a short.
  const entry = parseDecimal(levels.entry);
  const stopLoss = parseDecimal(levels.stopLoss);
  const tps = [parseDecimal(levels.tp1), parseDecimal(levels.tp2)];
  const direction = entry != null && stopLoss != null && stopLoss > entry ? 'short' : 'long';
  const warnings =
    entry != null && stopLoss != null
      ? validatePriceSides(direction, entry, stopLoss, tps.filter((t): t is number => t != null))
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
      ? [target === 'futures' ? PAIR.mini : PAIR.cfd, ...rows.map((r) => `${r.label}: ${convertTo(r.source, target).toFixed(decimals)}`)].join('\n')
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
      <h1 className="m-0 text-lg font-semibold tracking-[0.14em] uppercase">
        Kalkulator {PAIR.cfd} ↔ {PAIR.mini}
      </h1>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Panel brackets title={`1 · Różnica ${PAIR.mini} − ${PAIR.cfd}`} className="flex flex-col self-start">
          <div className="flex flex-col gap-4 p-5">
            <Segmented
              label="Sposób ustalenia różnicy"
              value={basisMode}
              onChange={(mode) => updateBasis({ mode })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'prices', label: 'Z 2 cen' },
                { value: 'offset', label: 'Ręcznie' },
              ]}
            />

            {basisMode === 'auto' && (
              <div className="flex flex-col gap-3">
                {!snapshot ? (
                  <p className="m-0 text-[13px] text-dim">Brak pomiarów. Kliknij „Sprawdź teraz”.</p>
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
                    <span className={`text-xs ${snapshot.live ? 'text-dim' : 'text-accent'}`}>
                      {snapshot.live
                        ? `Pomiar z ${shortTime(snapshot.measuredAt)}. ${PAIR.cfd} według ceny złota spot.`
                        : `Rynek był zamknięty (ostatnie notowania). ${PAIR.cfd} według ceny złota spot.`}
                    </span>
                    {measured?.alert ? (
                      <p role="alert" className="m-0 border border-sell p-3 text-[13px] text-sell">
                        Różnica zmieniła się o {formatNumber(measured.change, true)} pkt od poprzedniego pomiaru (próg{' '}
                        {formatNumber(measured.alertPoints)} pkt). Sprawdź poziomy przeliczone wcześniej.
                      </p>
                    ) : (
                      measured?.change != null && (
                        <span className="font-mono text-xs text-dim">
                          Zmiana od poprzedniego pomiaru: {formatNumber(measured.change, true)} pkt (próg{' '}
                          {formatNumber(measured.alertPoints)})
                        </span>
                      )
                    )}
                    {measured && measured.history.length > 1 && (
                      <details className="text-[13px]">
                        <summary className="cursor-pointer text-dim">Ostatnie pomiary</summary>
                        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 font-mono text-xs">
                          {measured.history.map((h) => (
                            <li key={h.id} className="flex justify-between gap-3">
                              <span className="text-dim">{shortTime(h.measuredAt)}</span>
                              <span>
                                {formatNumber(h.difference, true)} pkt{h.live ? '' : ' · zamknięty'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
                <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                  {refresh.isPending ? 'Sprawdzam…' : 'Sprawdź teraz'}
                </Button>
                {refresh.data?.results
                  .filter((r) => r.pairKey === PAIR.key && r.message)
                  .map((r) => (
                    <span key={r.pairKey} className="text-xs text-dim">
                      {r.message}
                    </span>
                  ))}
                <span className="text-xs text-dim">Serwer mierzy różnicę automatycznie co 4 godziny.</span>
              </div>
            )}

            {basisMode === 'prices' && (
              <>
                <p className="m-0 text-[13px] text-dim">Odczytaj obie ceny w tym samym momencie.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`${PAIR.cfd} teraz`}>
                    <Input inputMode="decimal" value={cfdPrice} onChange={(e) => updateBasis({ cfd: e.target.value })} placeholder="np. 4400" />
                  </Field>
                  <Field label={`${PAIR.mini} teraz`}>
                    <Input inputMode="decimal" value={futuresPrice} onChange={(e) => updateBasis({ futures: e.target.value })} placeholder="np. 4435" />
                  </Field>
                </div>
              </>
            )}

            {basisMode === 'offset' && (
              <Field label={`${PAIR.mini} − ${PAIR.cfd} (pkt)`} hint="ujemna, gdy GC1 niżej">
                <Input inputMode="decimal" value={offsetText} onChange={(e) => updateBasis({ offset: e.target.value })} placeholder="np. 35" />
              </Field>
            )}

            {difference != null && (
              <div className="flex items-baseline justify-between bg-chip px-3.5 py-3 font-mono text-[13px]">
                <span className="text-dim">
                  {PAIR.mini} względem {PAIR.cfd}
                </span>
                <span>
                  {formatNumber(difference, true)} pkt
                  {basis && basisMode !== 'offset' && ` · ${formatNumber((basis.futuresPrice / basis.cfdPrice - 1) * 100, true)}%`}
                </span>
              </div>
            )}

            {basisMode !== 'offset' && (
              <div className="flex flex-col gap-2">
                <span className="eyebrow">Metoda</span>
                <Segmented
                  label="Metoda przeliczenia"
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: 'offset', label: 'Różnica pkt' },
                    { value: 'ratio', label: 'Proporcja %' },
                  ]}
                />
                <span className="text-xs text-dim">
                  {method === 'offset'
                    ? 'Przesuwa cenę o tę samą liczbę punktów. Najlepsza w ciągu dnia.'
                    : 'Zachowuje odległość procentową. Lepsza dla cen daleko od bieżącej.'}
                </span>
              </div>
            )}
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel brackets title="2 · Przelicznik ceny" className="flex flex-col">
            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="eyebrow">Wpisuję cenę</span>
                <Segmented
                  label="Instrument ceny"
                  value={priceSide}
                  onChange={(side) => {
                    setPriceSide(side);
                    setPriceInput('');
                  }}
                  options={sideOptions}
                />
              </div>
              <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <Field label={`Cena ${priceSide === 'cfd' ? PAIR.cfd : PAIR.mini}`}>
                  <Input
                    inputMode="decimal"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder="wpisz cenę"
                    className="h-16 text-2xl"
                  />
                </Field>
                <span aria-hidden className="flex h-16 items-center justify-center px-2 text-2xl text-accent">
                  →
                </span>
                <div className="flex min-h-16 flex-col justify-center gap-1 border border-line bg-bg px-4 py-2">
                  <span className="eyebrow">{SIDE_LABEL[other(priceSide)]}</span>
                  <output className="font-mono text-2xl font-semibold" aria-live="polite">
                    {priceOut == null ? '—' : formatPrice(priceOut)}
                  </output>
                </div>
              </div>
              <span className="text-xs text-dim">
                {ready
                  ? `${PAIR.mini} zaokrąglony do ticka (${formatNumber(tick)} = ${formatMoney(tickValue, false)} USD na kontrakt), ${PAIR.cfd} do 0,01.`
                  : 'Najpierw ustal różnicę między rynkami (panel 1).'}
              </span>
            </div>
          </Panel>

          <Panel title="3 · Przelicz poziomy" className="flex flex-col">
            <div className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="eyebrow">Poziomy podane w</span>
                <Segmented label="Rynek poziomów" value={levelsSide} onChange={setLevelsSide} options={sideOptions} />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field label="Wejście (IN)">
                  <Input inputMode="decimal" value={levels.entry} onChange={setLevel('entry')} />
                </Field>
                <Field label="Stop loss">
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
                <ul className="m-0 list-none border border-sell p-3 text-[13px] text-sell">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            {ready && entry != null && (
              <>
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[560px] border-collapse font-mono text-sm">
                    <thead>
                      <tr className="eyebrow text-left">
                        <th className="border-b border-line px-5 py-3 font-semibold">Poziom</th>
                        <th className="border-b border-line px-3 py-3 font-semibold">{levelsSide === 'cfd' ? PAIR.cfd : PAIR.mini}</th>
                        <th className="border-b border-line px-3 py-3 font-semibold">{target === 'cfd' ? PAIR.cfd : PAIR.mini}</th>
                        <th className="border-b border-line px-3 py-3 text-right font-semibold">Ticki {PAIR.mini}</th>
                        <th className="border-b border-line px-5 py-3 text-right font-semibold">USD / 1 kontrakt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const ticks = entryGc != null && row.label !== 'IN' ? Math.abs(onGc(row.source) - entryGc) / tick : null;
                        const isSl = row.label === 'SL';
                        const tone = row.label === 'IN' ? '' : isSl ? 'text-sell' : 'text-buy';
                        return (
                          <tr key={row.label} className="border-b border-line last:border-b-0">
                            <td className="px-5 py-3 font-sans font-semibold">
                              {row.label}
                              {row.label.startsWith('TP') && riskTicks && ticks != null && (
                                <span className="ml-2 font-mono text-[11px] font-normal text-dim">R:R {formatNumber(ticks / riskTicks)}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-dim">{formatPrice(row.source)}</td>
                            <td className="px-3 py-3 text-base font-semibold">{formatPrice(convertTo(row.source, target))}</td>
                            <td className={`px-3 py-3 text-right ${tone}`}>{ticks == null ? '—' : formatNumber(ticks)}</td>
                            <td className={`px-5 py-3 text-right ${tone}`}>
                              {ticks == null ? '—' : `${isSl ? '−' : '+'}${formatMoney(ticks * tickValue, false)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end border-t border-line p-5">
                  <Button variant="primary" onClick={copy}>
                    {copied ? 'Skopiowano' : `Kopiuj poziomy ${target === 'cfd' ? PAIR.cfd : PAIR.mini}`}
                  </Button>
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}
