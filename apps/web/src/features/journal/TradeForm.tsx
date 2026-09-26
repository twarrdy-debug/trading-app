import type { Instrument, PublicUser, Trade, TradeMutation } from '@trading/api/types';
import { computeTradeMetrics, toLocalDate, type CreateTradeInput, type Direction, type TradeSource } from '@trading/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import {
  useCreateEducator,
  useDailySpread,
  useDeleteScreenshot,
  useDeleteTrade,
  useEducators,
  useEmotions,
  useParseSignal,
  useSaveSpread,
  useSaveTrade,
  useUploadScreenshot,
} from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented, Select, Textarea } from '../../components/ui/Field.tsx';
import { Brackets } from '../../components/ui/Panel.tsx';
import {
  formatMoney,
  formatNumber,
  formatPrice,
  parseDecimal,
  toDateTimeLocal,
  UNIT_LABEL,
  UNIT_NAME,
} from '../../lib/format.ts';

const priceText = (value: number | null | undefined) => (value == null ? '' : String(value).replace('.', ','));

/** Common position sizes offered as one-click presets. */
const CFD_SIZES = [0.01, 0.1, 0.5, 1];
const FUTURES_SIZES = [1, 2, 3, 5];

interface Props {
  user: PublicUser;
  instruments: Instrument[];
  /** Edit mode when set. */
  trade?: Trade;
  /** Pre-selected instrument for a new trade (the last one traded). */
  defaultInstrumentId?: string;
  onSaved: (result: TradeMutation, mode: 'created' | 'updated') => void;
  onDeleted: () => void;
  onCancel: () => void;
}

export function TradeForm({ user, instruments, trade, defaultInstrumentId, onSaved, onDeleted, onCancel }: Props) {
  const account = user.settings.accountCurrency;
  const [direction, setDirection] = useState<Direction>(trade?.direction ?? 'long');
  const [instrumentId, setInstrumentId] = useState(
    trade?.instrumentId ?? defaultInstrumentId ?? instruments.find((i) => i.market === 'cfd')?.id ?? instruments[0]?.id ?? '',
  );
  const [openedAt, setOpenedAt] = useState(toDateTimeLocal(trade ? new Date(trade.openedAt) : new Date()));
  const [closedAt, setClosedAt] = useState(trade?.closedAt ? toDateTimeLocal(new Date(trade.closedAt)) : '');
  const [entry, setEntry] = useState(priceText(trade?.entryPrice));
  const [exit, setExit] = useState(priceText(trade?.exitPrice));
  const [stopLoss, setStopLoss] = useState(priceText(trade?.stopLoss));
  const [takeProfit, setTakeProfit] = useState(priceText(trade?.takeProfit));
  const [size, setSize] = useState(priceText(trade?.positionSize));
  const [fxRate, setFxRate] = useState(trade?.fxRateSource === 'manual' ? priceText(trade.fxRate) : '');
  const [notes, setNotes] = useState(trade?.notes ?? '');
  const [source, setSource] = useState<TradeSource>(trade?.source ?? 'own');
  const [educatorId, setEducatorId] = useState(trade?.educatorId ?? '');
  const [emotionKeys, setEmotionKeys] = useState<string[]>(trade?.emotionKeys ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [signalOpen, setSignalOpen] = useState(false);
  const [signalText, setSignalText] = useState('');
  const [signalNotes, setSignalNotes] = useState<string[]>([]);
  const [newEducator, setNewEducator] = useState('');
  const [spreadText, setSpreadText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const emotions = useEmotions();
  const educators = useEducators();
  const saveTrade = useSaveTrade();
  const deleteTrade = useDeleteTrade();
  const upload = useUploadScreenshot();
  const removeShot = useDeleteScreenshot();
  const parseSignal = useParseSignal();
  const saveSpread = useSaveSpread();
  const createEducator = useCreateEducator();

  const instrument = instruments.find((i) => i.id === instrumentId);
  const tradeDate = openedAt ? toLocalDate(new Date(openedAt), user.settings.timezone) : undefined;
  const isCfd = instrument?.market === 'cfd';
  const spread = useDailySpread(isCfd ? instrumentId : undefined, tradeDate);

  // Pre-fill the spread question with the last known value.
  useEffect(() => {
    const suggestion = spread.data?.spread ?? spread.data?.suggestion?.spread;
    setSpreadText(suggestion == null ? '' : priceText(suggestion));
  }, [spread.data]);

  const askSpread = !trade && isCfd && spread.data?.askUser;
  const sameCurrency = instrument?.quoteCurrency === account;

  const preview = (() => {
    const entryPrice = parseDecimal(entry);
    const positionSize = parseDecimal(size);
    if (!instrument || entryPrice == null || positionSize == null) return null;
    return computeTradeMetrics(instrument, {
      direction,
      entryPrice,
      exitPrice: parseDecimal(exit),
      stopLoss: parseDecimal(stopLoss),
      takeProfit: parseDecimal(takeProfit),
      positionSize,
      fxRate: sameCurrency ? 1 : parseDecimal(fxRate),
    });
  })();

  const loadSignal = () => {
    parseSignal.mutate(signalText, {
      onSuccess: (result) => {
        if (!result.ok) {
          setSignalNotes(result.errors);
          return;
        }
        const { signal } = result;
        if (result.instrument) setInstrumentId(result.instrument.id);
        setDirection(signal.direction);
        setEntry(priceText(signal.entryPrice));
        setStopLoss(priceText(signal.stopLoss));
        setTakeProfit(priceText(signal.takeProfits[0]));
        setSource('educator');
        const extraTps = signal.takeProfits.slice(1).map((tp, i) => `TP${i + 2} ${formatPrice(tp)}`);
        if (extraTps.length > 0) setNotes((n) => [n, `Sygnał: ${extraTps.join(', ')}`].filter(Boolean).join('\n'));
        setSignalNotes([
          `Wczytano ${signal.symbol} ${signal.direction.toUpperCase()}${extraTps.length ? `; kolejne TP dopisane do notatek` : ''}.`,
          ...result.warnings,
        ]);
        setSignalOpen(false);
      },
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors([]);
    const entryPrice = parseDecimal(entry);
    const positionSize = parseDecimal(size);
    if (!instrument || entryPrice == null || positionSize == null) {
      setErrors(['Uzupełnij instrument, cenę wejścia i wielkość pozycji.']);
      return;
    }
    if (instrument.market === 'futures' && !Number.isInteger(positionSize)) {
      setErrors(['Futures handluje się pełnymi kontraktami (1, 2, 3…).']);
      return;
    }
    if (source === 'educator' && !educatorId) {
      setErrors(['Wybierz edukatora, od którego pochodzi sygnał.']);
      return;
    }

    try {
      const spreadValue = parseDecimal(spreadText);
      if (askSpread && spreadValue != null && tradeDate) {
        await saveSpread.mutateAsync({ instrumentId, date: tradeDate, spread: spreadValue });
      }

      const input: Partial<CreateTradeInput> = {
        instrumentId,
        direction,
        openedAt: new Date(openedAt).toISOString(),
        closedAt: closedAt ? new Date(closedAt).toISOString() : null,
        entryPrice,
        exitPrice: parseDecimal(exit) ?? null,
        stopLoss: parseDecimal(stopLoss) ?? null,
        takeProfit: parseDecimal(takeProfit) ?? null,
        positionSize,
        fxRate: parseDecimal(fxRate) ?? null,
        notes: notes.trim() || null,
        source,
        educatorId: source === 'educator' ? educatorId : null,
        signalId: source === 'educator' ? trade?.signalId : null,
        emotionKeys,
      };
      const result = await saveTrade.mutateAsync({ id: trade?.id, input });
      for (const file of files) await upload.mutateAsync({ tradeId: result.trade.id, file });
      onSaved(result, trade ? 'updated' : 'created');
    } catch (err) {
      setErrors(err instanceof ApiError ? err.lines : [(err as Error).message]);
    }
  };

  const remove = () => {
    if (!trade || !window.confirm(`Usunąć transakcję ${trade.dayLabel}?`)) return;
    deleteTrade.mutate(trade.id, { onSuccess: onDeleted });
  };

  const busy = saveTrade.isPending || upload.isPending || saveSpread.isPending;
  const unit = instrument ? UNIT_LABEL[instrument.measureUnit] : '';
  const isFutures = instrument?.market === 'futures';
  const sizeLabel = isFutures ? 'Kontrakty' : 'Loty';
  const cfd = instruments.filter((i) => i.market === 'cfd');
  const futures = instruments.filter((i) => i.market === 'futures');

  return (
    <form onSubmit={submit} className="relative flex flex-col gap-4 border border-line bg-panel p-5" aria-label={trade ? 'Edycja transakcji' : 'Nowa transakcja'}>
      <Brackets bottom={false} />
      <div className="flex items-center gap-3">
        <h2 className="m-0 text-[13px] font-semibold tracking-[0.16em] uppercase">{trade ? `Edycja ${trade.dayLabel}` : 'Nowa transakcja'}</h2>
        <div className="grow" />
        {trade && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Zamknij
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Kierunek">
        <Button variant="buy" size="xl" selected={direction === 'long'} onClick={() => setDirection('long')}>
          Buy
        </Button>
        <Button variant="sell" size="xl" selected={direction === 'short'} onClick={() => setDirection('short')}>
          Sell
        </Button>
      </div>

      {!trade && (
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={() => setSignalOpen((v) => !v)} aria-expanded={signalOpen}>
            {signalOpen ? 'Ukryj sygnał' : 'Wklej sygnał'}
          </Button>
          {signalOpen && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="Treść sygnału"
                placeholder={'XAUUSD - SELL\nIN: 4406.50\nSL: 4414\nTP1: 4390\nTP2: 4384'}
                value={signalText}
                onChange={(e) => setSignalText(e.target.value)}
                className="min-h-28"
              />
              <Button size="sm" variant="primary" onClick={loadSignal} disabled={!signalText.trim() || parseSignal.isPending}>
                Wczytaj do formularza
              </Button>
            </div>
          )}
          {signalNotes.length > 0 && (
            <ul className="m-0 list-none border border-line p-3 text-[13px] text-dim">
              {signalNotes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Field label="Instrument" hint={instrument ? `${instrument.market === 'cfd' ? 'CFD' : 'Futures'} · ${UNIT_NAME[instrument.measureUnit].toLowerCase()}` : undefined}>
        <Select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} required>
          <optgroup label="CFD">
            {cfd.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Futures">
            {futures.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} · {i.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Otwarcie" className="col-span-2">
          <Input type="datetime-local" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} required />
        </Field>
        <Field label="Zamknięcie" className="col-span-2">
          <Input type="datetime-local" value={closedAt} onChange={(e) => setClosedAt(e.target.value)} />
        </Field>
        <Field label="Cena wejścia">
          <Input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} required />
        </Field>
        <Field label="Cena wyjścia">
          <Input inputMode="decimal" value={exit} onChange={(e) => setExit(e.target.value)} placeholder="otwarta" />
        </Field>
        <Field label="Stop loss">
          <Input inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </Field>
        <Field label="Take profit">
          <Input inputMode="decimal" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <Field label={sizeLabel} hint={isFutures ? 'pełne kontrakty' : 'dowolna wielkość'}>
          <Input
            inputMode={isFutures ? 'numeric' : 'decimal'}
            value={size}
            onChange={(e) => setSize(isFutures ? e.target.value.replace(/\D/g, '') : e.target.value)}
            required
          />
        </Field>
        <div role="group" aria-label={`Szybki wybór: ${sizeLabel.toLowerCase()}`} className="flex gap-1.5">
          {(isFutures ? FUTURES_SIZES : CFD_SIZES).map((preset) => {
            const active = parseDecimal(size) === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => setSize(priceText(preset))}
                className={`h-9 grow border font-mono text-[13px] transition ${
                  active ? 'border-accent bg-accent/15 text-ink' : 'border-line text-dim hover:text-ink'
                }`}
              >
                {priceText(preset)}
              </button>
            );
          })}
        </div>
      </div>

      {instrument && !sameCurrency && (
        <Field label={`Kurs ${instrument.quoteCurrency}/${account}`} hint="puste = automatyczny (EBC)">
          <Input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="auto" />
        </Field>
      )}

      {isCfd && spread.data && (
        <div className={`flex flex-col gap-2.5 p-3.5 ${askSpread ? 'border border-dashed border-accent' : 'border border-line'}`}>
          <span className="text-[13px] font-semibold">
            {askSpread ? `Spread ${instrument?.symbol} na ${tradeDate === toLocalDate(new Date(), user.settings.timezone) ? 'dziś' : tradeDate}?` : `Spread ${instrument?.symbol} tego dnia`}
          </span>
          {askSpread ? (
            <div className="flex items-end gap-2">
              <Field label={UNIT_NAME[instrument!.measureUnit]} className="grow">
                <Input inputMode="decimal" value={spreadText} onChange={(e) => setSpreadText(e.target.value)} placeholder="np. 2,5" />
              </Field>
              {spread.data.suggestion && (
                <span className="flex h-11 items-center bg-chip px-2.5 font-mono text-xs text-dim">
                  ostatnio {formatNumber(spread.data.suggestion.spread)} ({spread.data.suggestion.date.slice(5).split('-').reverse().join('.')})
                </span>
              )}
            </div>
          ) : (
            <span className="font-mono text-sm text-dim">
              {formatNumber(spread.data.spread)} {unit}
            </span>
          )}
          {askSpread && <span className="text-xs text-dim">Zapiszę go razem z transakcją. Kolejne transakcje tego dnia użyją go automatycznie.</span>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="eyebrow">Źródło</span>
        <Segmented
          label="Źródło transakcji"
          value={source}
          onChange={setSource}
          options={[
            { value: 'own', label: 'Własna analiza' },
            { value: 'educator', label: 'Edukator' },
          ]}
        />
        {source === 'educator' && (
          <div className="flex flex-col gap-2">
            <Select aria-label="Edukator" value={educatorId} onChange={(e) => setEducatorId(e.target.value)}>
              <option value="">Wybierz edukatora…</option>
              {educators.data?.map((ed) => (
                <option key={ed.id} value={ed.id}>
                  {ed.displayName}
                </option>
              ))}
            </Select>
            {user.role === 'admin' && (
              <div className="flex gap-2">
                <Input aria-label="Nowy edukator" placeholder="Dodaj edukatora" value={newEducator} onChange={(e) => setNewEducator(e.target.value)} />
                <Button
                  size="md"
                  disabled={!newEducator.trim() || createEducator.isPending}
                  onClick={() =>
                    createEducator.mutate(newEducator.trim(), {
                      onSuccess: (ed) => {
                        setEducatorId(ed.id);
                        setNewEducator('');
                      },
                    })
                  }
                >
                  Dodaj
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="eyebrow mb-2">Emocje przy wejściu</legend>
        <div className="flex flex-wrap gap-1.5">
          {emotions.data?.map((em) => {
            const checked = emotionKeys.includes(em.key);
            return (
              <label
                key={em.key}
                className={`flex h-9 cursor-pointer items-center gap-2 border px-2.5 text-[13px] transition has-focus-visible:border-ink ${
                  checked ? 'border-accent bg-accent/15 text-ink' : 'border-line text-dim hover:text-ink'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => setEmotionKeys((keys) => (checked ? keys.filter((k) => k !== em.key) : [...keys, em.key]))}
                />
                <span aria-hidden className={`size-2.5 rotate-45 ${checked ? 'bg-accent' : 'border border-dim'}`} />
                {em.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Field label="Notatki">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10_000} className="font-sans" />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="eyebrow">Zrzuty ekranu wykresu</span>
        {trade && trade.screenshots.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
            {trade.screenshots.map((shot) => (
              <li key={shot.id} className="relative">
                <a href={shot.url} target="_blank" rel="noreferrer" className="block border border-line">
                  <img src={shot.url} alt="Zrzut ekranu wykresu" className="block aspect-video w-full object-cover" />
                </a>
                <button
                  type="button"
                  aria-label="Usuń zrzut ekranu"
                  onClick={() => removeShot.mutate({ tradeId: trade.id, screenshotId: shot.id })}
                  className="absolute top-1 right-1 flex size-7 items-center justify-center bg-bg/90 text-sell"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          aria-label="Dodaj zrzuty ekranu"
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
          className="text-sm text-dim file:mr-3 file:h-9 file:cursor-pointer file:border file:border-line file:bg-transparent file:px-3 file:font-sans file:text-xs file:font-bold file:tracking-[0.14em] file:text-ink file:uppercase"
        />
      </div>

      {preview && (
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 bg-chip p-3.5 font-mono text-[13px]">
          <dt className="text-dim">Wynik</dt>
          <dd className={`m-0 text-right ${(preview.resultUnits ?? 0) >= 0 ? 'text-buy' : 'text-sell'}`}>
            {preview.resultUnits == null ? 'otwarta' : `${formatNumber(preview.resultUnits, true)} ${unit}`}
          </dd>
          <dt className="text-dim">W walucie</dt>
          <dd className="m-0 text-right">
            {preview.pnlAccount != null
              ? `${formatMoney(preview.pnlAccount)} ${account}`
              : preview.pnlQuote != null
                ? `${formatMoney(preview.pnlQuote)} ${instrument?.quoteCurrency}`
                : '—'}
          </dd>
          <dt className="text-dim">Ryzyko</dt>
          <dd className="m-0 text-right">{preview.riskUnits == null ? '—' : `${formatNumber(preview.riskUnits)} ${unit}`}</dd>
          <dt className="text-dim">R · plan R:R</dt>
          <dd className="m-0 text-right">
            {formatNumber(preview.rMultiple, true)} R · {formatNumber(preview.plannedRR)}
          </dd>
        </dl>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-none border border-sell p-3 text-[13px] text-sell">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={busy}>
        {busy ? 'Zapisywanie…' : trade ? 'Zapisz zmiany' : 'Dodaj transakcję'}
      </Button>
      {trade && (
        <Button variant="danger" onClick={remove} disabled={deleteTrade.isPending}>
          Usuń transakcję
        </Button>
      )}
    </form>
  );
}
