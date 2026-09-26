import type { Instrument } from '@trading/api/types';
import {
  CFD_FUTURES_PAIRS,
  convertLevel,
  findPairBySymbol,
  normalizeSymbol,
  parseSignal,
  roundToStep,
  validatePriceSides,
  type BasisMethod,
  type Direction,
} from '@trading/shared';
import { useEffect, useState } from 'react';
import { useInstruments } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented, Select, Textarea } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { formatMoney, formatNumber, formatPrice, parseDecimal } from '../../lib/format.ts';

type Side = 'cfd' | 'futures';

const priceText = (value: number) => String(value).replace('.', ',');

type BasisMode = 'prices' | 'offset';

interface StoredBasis {
  mode: BasisMode;
  cfd: string;
  futures: string;
  offset: string;
  savedAt: string;
}

/** Last basis entered per pair, so it survives a reload. Browser-only convenience. */
function loadBasis(pairKey: string): Partial<StoredBasis> | null {
  try {
    const raw = localStorage.getItem(`calc-basis-${pairKey}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveBasis(pairKey: string, basis: Omit<StoredBasis, 'savedAt'>) {
  try {
    localStorage.setItem(`calc-basis-${pairKey}`, JSON.stringify({ ...basis, savedAt: new Date().toISOString() }));
  } catch {
    // Storage unavailable (private mode): the calculator still works for this visit.
  }
}

export function CalculatorPage() {
  const { data: instruments } = useInstruments();
  // The instrument whose price is typed in; its CFD/futures counterparts are computed.
  const [symbol, setSymbol] = useState('XAUUSD');
  const [from, setFrom] = useState<Side>('cfd');
  const [method, setMethod] = useState<BasisMethod>('offset');
  const [basisMode, setBasisMode] = useState<BasisMode>('prices');
  const [cfdPrice, setCfdPrice] = useState('');
  const [futuresPrice, setFuturesPrice] = useState('');
  const [offsetText, setOffsetText] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('short');
  const [entry, setEntry] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfits, setTakeProfits] = useState<string[]>(['']);
  const [signalText, setSignalText] = useState('');
  const [signalNotes, setSignalNotes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const selected = findPairBySymbol(symbol)!;
  const pair = selected.pair;
  const pairKey = pair.key;
  const to: Side = from === 'cfd' ? 'futures' : 'cfd';

  const selectSymbol = (next: string) => {
    setSymbol(next);
    setFrom(findPairBySymbol(next)!.side);
    setPriceInput('');
  };

  useEffect(() => {
    const stored = loadBasis(pairKey);
    setBasisMode(stored?.mode ?? 'prices');
    setCfdPrice(stored?.cfd ?? '');
    setFuturesPrice(stored?.futures ?? '');
    setOffsetText(stored?.offset ?? '');
    setSavedAt(stored?.savedAt ?? null);
  }, [pairKey]);

  const updateBasis = (patch: Partial<Omit<StoredBasis, 'savedAt'>>) => {
    const next = { mode: basisMode, cfd: cfdPrice, futures: futuresPrice, offset: offsetText, ...patch };
    setBasisMode(next.mode);
    setCfdPrice(next.cfd);
    setFuturesPrice(next.futures);
    setOffsetText(next.offset);
    saveBasis(pairKey, next);
    setSavedAt(new Date().toISOString());
  };

  const bySymbol = (symbol: string): Instrument | undefined => instruments?.find((i) => i.symbol === symbol);
  const mini = bySymbol(pair.mini);
  const micro = bySymbol(pair.micro);
  const tick = mini?.unitSize ?? 0.25;

  const cfd = parseDecimal(cfdPrice);
  const fut = parseDecimal(futuresPrice);
  const basis = cfd && fut ? { cfdPrice: cfd, futuresPrice: fut } : null;
  const offset = parseDecimal(offsetText);
  /** Points to add to a CFD price to get the futures price. */
  const difference = basisMode === 'offset' ? offset : basis ? basis.futuresPrice - basis.cfdPrice : undefined;
  const ready = basisMode === 'offset' ? offset != null : basis != null;

  /** Converts a price to the given market, rounded to the futures tick or to 0.01 for CFD. */
  const convertTo = (price: number, target: Side) => {
    const raw =
      basisMode === 'offset'
        ? price + (target === 'futures' ? offset! : -offset!)
        : convertLevel(price, basis!, target, method);
    return target === 'futures' ? roundToStep(raw, tick) : Math.round(raw * 100) / 100;
  };
  const convert = (price: number) => convertTo(price, to);

  // Counterparts of the selected instrument: a CFD maps to both futures contracts;
  // a futures contract maps to the CFD and to its mini/micro sibling (same price).
  const priceNum = parseDecimal(priceInput);
  const counterparts =
    selected.side === 'cfd'
      ? [pair.mini, pair.micro].map((s) => ({ symbol: s, price: ready && priceNum != null ? convertTo(priceNum, 'futures') : null }))
      : [
          { symbol: pair.cfd, price: ready && priceNum != null ? convertTo(priceNum, 'cfd') : null },
          { symbol: symbol === pair.mini ? pair.micro : pair.mini, price: priceNum ?? null },
        ];
  /** Price of a level on the futures side, for risk in ticks. */
  const onFutures = (source: number) => (from === 'futures' ? source : convert(source));

  const entryNum = parseDecimal(entry);
  const slNum = parseDecimal(stopLoss);
  const tpNums = takeProfits.map(parseDecimal);

  const rows = [
    { label: 'IN', source: entryNum },
    { label: 'SL', source: slNum },
    ...tpNums.map((source, i) => ({ label: `TP${i + 1}`, source })),
  ];

  const entryFut = ready && entryNum != null ? onFutures(entryNum) : null;
  const slFut = ready && slNum != null ? onFutures(slNum) : null;
  const riskTicks = entryFut != null && slFut != null ? Math.abs(entryFut - slFut) / tick : null;

  const warnings =
    entryNum != null
      ? validatePriceSides(direction, entryNum, slNum, tpNums.filter((t): t is number => t != null))
      : [];

  const loadSignal = () => {
    const result = parseSignal(signalText);
    if (!result.ok) {
      setSignalNotes(result.errors);
      return;
    }
    const { signal } = result;
    const match = findPairBySymbol(signal.symbol);
    if (match) {
      setSymbol(match.side === 'cfd' ? match.pair.cfd : normalizeSymbol(signal.symbol));
      setFrom(match.side);
    }
    setDirection(signal.direction);
    setEntry(priceText(signal.entryPrice));
    setStopLoss(priceText(signal.stopLoss));
    setTakeProfits(signal.takeProfits.map(priceText));
    setSignalNotes([
      match
        ? `Wczytano ${signal.symbol} ${signal.direction === 'long' ? 'BUY' : 'SELL'} jako ${match.side === 'cfd' ? 'CFD' : 'futures'}.`
        : `Nie znam pary CFD/futures dla ${signal.symbol}. Wybierz ją ręcznie.`,
      ...result.warnings,
    ]);
  };

  const targetSymbol = to === 'futures' ? `${pair.mini} / ${pair.micro}` : pair.cfd;
  const decimals = to === 'futures' ? (String(tick).split('.')[1] ?? '').length : 2;
  const signalOut =
    ready && entryNum != null && slNum != null
      ? [
          `${to === 'futures' ? pair.mini : pair.cfd} - ${direction === 'long' ? 'BUY' : 'SELL'}`,
          `IN: ${convert(entryNum).toFixed(decimals)}`,
          `SL: ${convert(slNum).toFixed(decimals)}`,
          ...tpNums.flatMap((tp, i) => (tp == null ? [] : [`TP${i + 1}: ${convert(tp).toFixed(decimals)}`])),
        ].join('\n')
      : null;

  const copy = async () => {
    if (!signalOut) return;
    try {
      await navigator.clipboard.writeText(signalOut);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const lastTp = takeProfits.at(-1) ?? '';

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-lg font-semibold tracking-[0.14em] uppercase">Kalkulator CFD ↔ Futures</h1>
        <div className="grow" />
        <div className="w-72">
          <Select aria-label="Instrument" value={symbol} onChange={(e) => selectSymbol(e.target.value)}>
            <optgroup label="CFD">
              {CFD_FUTURES_PAIRS.map((p) => (
                <option key={p.cfd} value={p.cfd}>
                  {p.cfd} · {p.label} CFD
                </option>
              ))}
            </optgroup>
            <optgroup label="Futures">
              {CFD_FUTURES_PAIRS.flatMap((p) => [
                <option key={p.mini} value={p.mini}>
                  {p.mini} · {p.label} mini
                </option>,
                <option key={p.micro} value={p.micro}>
                  {p.micro} · {p.label} micro
                </option>,
              ])}
            </optgroup>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Panel brackets title="1 · Różnica CFD / Futures" className="flex flex-col">
            <div className="flex flex-col gap-4 p-5">
              <Segmented
                label="Sposób podania różnicy"
                value={basisMode}
                onChange={(mode) => updateBasis({ mode })}
                options={[
                  { value: 'prices', label: 'Z dwóch cen' },
                  { value: 'offset', label: 'Wpisz różnicę' },
                ]}
              />
              {basisMode === 'prices' ? (
                <>
                  <p className="m-0 text-[13px] text-dim">
                    Odczytaj obie ceny w tym samym momencie. Różnica zmienia się w ciągu dnia i przy zmianie serii kontraktu.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={`${pair.cfd} · CFD teraz`}>
                      <Input inputMode="decimal" value={cfdPrice} onChange={(e) => updateBasis({ cfd: e.target.value })} placeholder="np. 24000" />
                    </Field>
                    <Field label={`${pair.mini} · Futures teraz`}>
                      <Input inputMode="decimal" value={futuresPrice} onChange={(e) => updateBasis({ futures: e.target.value })} placeholder="np. 24120" />
                    </Field>
                  </div>
                </>
              ) : (
                <Field label={`Futures − CFD (pkt)`} hint="ujemna, gdy futures niżej">
                  <Input inputMode="decimal" value={offsetText} onChange={(e) => updateBasis({ offset: e.target.value })} placeholder="np. 122,75" />
                </Field>
              )}
              {difference != null ? (
                <div className="flex items-baseline justify-between bg-chip px-3.5 py-3 font-mono text-[13px]">
                  <span className="text-dim">Futures względem CFD</span>
                  <span>
                    {formatNumber(difference, true)} pkt
                    {basis && basisMode === 'prices' && ` · ${formatNumber((basis.futuresPrice / basis.cfdPrice - 1) * 100, true)}%`}
                  </span>
                </div>
              ) : (
                <span className="text-[13px] text-dim">
                  {basisMode === 'prices' ? 'Wpisz obie ceny, żeby przeliczać.' : 'Wpisz różnicę, żeby przeliczać.'}
                </span>
              )}
              {savedAt && (
                <span className="font-mono text-[11px] text-dim">
                  Zapisane {new Date(savedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {basisMode === 'prices' && (
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

          <Panel title="3 · Przelicz cały sygnał" className="flex flex-col">
            <div className="flex flex-col gap-4 p-5">
              <Textarea
                aria-label="Wklej sygnał"
                placeholder={'US100 - SELL\nIN: 24050\nSL: 24090\nTP1: 23980\nTP2: 23940'}
                value={signalText}
                onChange={(e) => setSignalText(e.target.value)}
                className="min-h-28"
              />
              <Button size="sm" variant="primary" onClick={loadSignal} disabled={!signalText.trim()}>
                Wczytaj sygnał
              </Button>
              {signalNotes.length > 0 && (
                <ul className="m-0 list-none border border-line p-3 text-[13px] text-dim">
                  {signalNotes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-2">
                <span className="eyebrow">Poziomy podane w</span>
                <Segmented
                  label="Rynek poziomów"
                  value={from}
                  onChange={setFrom}
                  options={[
                    { value: 'cfd', label: `CFD → Futures` },
                    { value: 'futures', label: `Futures → CFD` },
                  ]}
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Kierunek">
                <Button variant="buy" size="lg" selected={direction === 'long'} onClick={() => setDirection('long')}>
                  Buy
                </Button>
                <Button variant="sell" size="lg" selected={direction === 'short'} onClick={() => setDirection('short')}>
                  Sell
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="IN">
                  <Input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} />
                </Field>
                <Field label="SL">
                  <Input inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
                </Field>
                {takeProfits.map((tp, i) => (
                  <Field key={i} label={`TP${i + 1}`}>
                    <div className="flex gap-1">
                      <Input
                        inputMode="decimal"
                        value={tp}
                        onChange={(e) => setTakeProfits((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
                      />
                      {takeProfits.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Usuń TP${i + 1}`}
                          onClick={() => setTakeProfits((list) => list.filter((_, j) => j !== i))}
                          className="w-9 shrink-0 border border-line text-dim hover:text-sell"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </Field>
                ))}
              </div>
              {lastTp.trim() !== '' && takeProfits.length < 10 && (
                <Button size="sm" variant="secondary" onClick={() => setTakeProfits((list) => [...list, ''])}>
                  + Dodaj TP{takeProfits.length + 1}
                </Button>
              )}
              {warnings.length > 0 && (
                <ul className="m-0 list-none border border-sell p-3 text-[13px] text-sell">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-5 self-start">
          <Panel brackets title="2 · Przelicznik ceny" className="flex flex-col">
            <div className="flex flex-col gap-4 p-5">
              <Field label={`Cena ${symbol} · ${selected.side === 'cfd' ? 'CFD' : 'Futures'}`}>
                <Input
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  placeholder="wpisz cenę"
                  className="h-16 text-2xl"
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {counterparts.map((c) => {
                  const instrument = bySymbol(c.symbol);
                  const side = findPairBySymbol(c.symbol)!.side;
                  return (
                    <div key={c.symbol} className="flex flex-col gap-1 border border-line bg-bg px-4 py-3">
                      <span className="eyebrow">
                        {c.symbol} · {side === 'cfd' ? 'CFD' : c.symbol === pair.mini ? 'Futures mini' : 'Futures micro'}
                      </span>
                      <output className="font-mono text-2xl font-semibold" aria-live="polite">
                        {c.price == null ? '—' : formatPrice(c.price)}
                      </output>
                      {instrument && side === 'futures' && (
                        <span className="font-mono text-[11px] text-dim">
                          tick {formatNumber(instrument.unitSize)} = {formatMoney(instrument.unitValue, false)} USD
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <span className="text-xs text-dim">
                {ready
                  ? `Cena futures zaokrąglona do ticka (${formatNumber(tick)}), cena CFD do 0,01.`
                  : 'Najpierw podaj różnicę między rynkami (panel 1).'}
              </span>
            </div>
          </Panel>

          <Panel title={`4 · Przeliczony sygnał · ${targetSymbol}`} className="flex flex-col">
            {!ready || entryNum == null ? (
              <p className="m-0 p-5 text-sm text-dim">
                {!ready ? 'Najpierw podaj różnicę między rynkami (panel 1).' : 'Wpisz poziomy albo wklej sygnał w panelu 3.'}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse font-mono text-sm">
                    <thead>
                      <tr className="eyebrow text-left">
                        <th className="border-b border-line px-5 py-3 font-semibold">Poziom</th>
                        <th className="border-b border-line px-3 py-3 font-semibold">{from === 'cfd' ? pair.cfd : pair.mini}</th>
                        <th className="border-b border-line px-3 py-3 font-semibold">{to === 'cfd' ? pair.cfd : pair.mini}</th>
                        <th className="border-b border-line px-3 py-3 text-right font-semibold">Ticki</th>
                        <th className="border-b border-line px-3 py-3 text-right font-semibold">{pair.mini} / 1 kontr.</th>
                        <th className="border-b border-line px-5 py-3 text-right font-semibold">{pair.micro} / 1 kontr.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const target = row.source == null ? null : convert(row.source);
                        const futPrice = row.source == null ? null : onFutures(row.source);
                        const ticks = entryFut != null && futPrice != null && row.label !== 'IN' ? Math.abs(futPrice - entryFut) / tick : null;
                        const isSl = row.label === 'SL';
                        const tone = row.label === 'IN' ? '' : isSl ? 'text-sell' : 'text-buy';
                        const money = (value: number | undefined) =>
                          ticks == null || value == null ? '—' : `${isSl ? '−' : '+'}${formatMoney(ticks * value, false)}`;
                        return (
                          <tr key={row.label} className="border-b border-line last:border-b-0">
                            <td className="px-5 py-3 font-sans font-semibold">
                              {row.label}
                              {!isSl && row.label !== 'IN' && riskTicks && ticks != null && (
                                <span className="ml-2 font-mono text-[11px] font-normal text-dim">R:R {formatNumber(ticks / riskTicks)}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-dim">{formatPrice(row.source)}</td>
                            <td className="px-3 py-3 text-base font-semibold">{target == null ? '—' : formatPrice(target)}</td>
                            <td className={`px-3 py-3 text-right ${tone}`}>{ticks == null ? '—' : formatNumber(ticks)}</td>
                            <td className={`px-3 py-3 text-right ${tone}`}>{money(mini?.unitValue)}</td>
                            <td className={`px-5 py-3 text-right ${tone}`}>{money(micro?.unitValue)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 border-t border-line p-5">
                  <span className="text-xs text-dim">
                    Ceny futures zaokrąglone do ticka ({formatNumber(tick)}). Kwoty w USD dla 1 kontraktu: {pair.mini} {formatMoney(mini?.unitValue, false)} / tick, {pair.micro}{' '}
                    {formatMoney(micro?.unitValue, false)} / tick.
                  </span>
                  {signalOut && (
                    <>
                      <pre className="m-0 bg-chip p-3.5 font-mono text-[13px] whitespace-pre-wrap">{signalOut}</pre>
                      <Button variant="primary" onClick={copy}>
                        {copied ? 'Skopiowano' : 'Kopiuj przeliczony sygnał'}
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}
