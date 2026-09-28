import type { AccountSummary, Instrument, PublicUser, Trade, TradeMutation } from '@trading/api/types';
import { computeTradeMetrics, marginQuote, riskQuote, toLocalDate, type CreateTradeInput, type Direction, type TradeSource } from '@trading/shared';
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
import { Field, Input, Segmented, Textarea, toggleClass } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { accountKind } from '../account/AccountViews.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatDate, formatMoney, formatNumber, formatPrice, parseDecimal, toDateTimeLocal, toInputNumber } from '../../lib/format.ts';

const priceText = toInputNumber;

/** Common position sizes offered as one-click presets. */
const CFD_SIZES = [0.01, 0.1, 0.5, 1];
const FUTURES_SIZES = [1, 2, 3, 5];

/** Step of the "+" button, from the lot chosen before any "+" clicks: under 0.1 → 0.01, under 1 → 0.1, else 1. */
const sizeStep = (base: number, futures: boolean) => (futures || base >= 1 ? 1 : base >= 0.1 ? 0.1 : 0.01);
const roundSize = (n: number) => Math.round(n * 100) / 100;

interface Props {
  user: PublicUser;
  instruments: Instrument[];
  /** Edit mode when set. */
  trade?: Trade;
  /** Pre-selected instrument for a new trade (the last one traded). */
  defaultInstrumentId?: string;
  accounts: AccountSummary[];
  /** Account for a new trade ('' = none). */
  defaultAccountId: string;
  onSaved: (result: TradeMutation, mode: 'created' | 'updated') => void;
  onDeleted: () => void;
  onCancel: () => void;
}

export function TradeForm({ user, instruments, trade, defaultInstrumentId, accounts, defaultAccountId, onSaved, onDeleted, onCancel }: Props) {
  const all = useT();
  const t = all.form;
  const account = user.settings.accountCurrency;
  const [direction, setDirection] = useState<Direction>(trade?.direction ?? 'long');
  const [accountId, setAccountId] = useState(trade ? (trade.accountId ?? '') : defaultAccountId);
  const tradeAccount = accounts.find((a) => a.id === accountId);
  // A prop account trades one market; the instrument list follows it.
  const allowed = tradeAccount?.market ? instruments.filter((i) => i.market === tradeAccount.market) : instruments;
  const [instrumentId, setInstrumentId] = useState(() => {
    const preferred = trade?.instrumentId ?? defaultInstrumentId;
    return allowed.find((i) => i.id === preferred)?.id ?? allowed.find((i) => i.market === 'cfd')?.id ?? allowed[0]?.id ?? '';
  });
  const chooseAccount = (id: string) => {
    setAccountId(id);
    const market = accounts.find((a) => a.id === id)?.market;
    const current = instruments.find((i) => i.id === instrumentId);
    if (market && current?.market !== market) setInstrumentId(instruments.find((i) => i.market === market)?.id ?? '');
  };
  const [openedAt, setOpenedAt] = useState(toDateTimeLocal(trade ? new Date(trade.openedAt) : new Date()));
  const [closedAt, setClosedAt] = useState(trade?.closedAt ? toDateTimeLocal(new Date(trade.closedAt)) : '');
  const [entry, setEntry] = useState(priceText(trade?.entryPrice));
  const [exit, setExit] = useState(priceText(trade?.exitPrice));
  const [stopLoss, setStopLoss] = useState(priceText(trade?.stopLoss));
  const [takeProfit, setTakeProfit] = useState(priceText(trade?.takeProfit));
  const [size, setSizeText] = useState(priceText(trade?.positionSize));
  /** The lot the "+" step is based on; "+" clicks leave it unchanged. */
  const [sizeBase, setSizeBase] = useState(trade?.positionSize ?? undefined);
  const setSize = (text: string) => {
    setSizeText(text);
    setSizeBase(parseDecimal(text));
  };
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
  // Risk % and margin use the chosen account's current balance and leverage.
  const balance = tradeAccount?.balance ?? null;
  const leverage = tradeAccount?.leverage ?? null;

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

  // Money at risk and CFD margin in the account currency (need the quote → account rate).
  const rate = sameCurrency ? 1 : (parseDecimal(fxRate) ?? null);
  const entryNum = parseDecimal(entry);
  const sizeNum = parseDecimal(size);
  const riskMoney =
    instrument && entryNum != null && sizeNum != null && rate != null
      ? (() => {
          const quote = riskQuote(instrument, { entryPrice: entryNum, stopLoss: parseDecimal(stopLoss), positionSize: sizeNum });
          return quote == null ? null : quote * rate;
        })()
      : null;
  const margin =
    isCfd && leverage && instrument && entryNum != null && sizeNum != null && rate != null
      ? marginQuote(instrument, entryNum, sizeNum, leverage) * rate
      : null;

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
        if (extraTps.length > 0) setNotes((n) => [n, t.signalNote(extraTps.join(', '))].filter(Boolean).join('\n'));
        setSignalNotes([
          t.signalLoaded(signal.symbol, signal.direction.toUpperCase(), extraTps.length > 0),
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
      setErrors([t.errRequired]);
      return;
    }
    if (instrument.market === 'futures' && !Number.isInteger(positionSize)) {
      setErrors([t.errFutures]);
      return;
    }
    if (source === 'educator' && !educatorId) {
      setErrors([t.errEducator]);
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
        accountId: accountId || null,
      };
      const result = await saveTrade.mutateAsync({ id: trade?.id, input });
      for (const file of files) await upload.mutateAsync({ tradeId: result.trade.id, file });
      onSaved(result, trade ? 'updated' : 'created');
    } catch (err) {
      setErrors(err instanceof ApiError ? err.lines : [(err as Error).message]);
    }
  };

  const remove = () => {
    if (!trade || !window.confirm(t.confirmDelete(trade.dayLabel))) return;
    deleteTrade.mutate(trade.id, { onSuccess: onDeleted });
  };

  const busy = saveTrade.isPending || upload.isPending || saveSpread.isPending;
  const unit = instrument ? all.units.short[instrument.measureUnit] : '';
  const isFutures = instrument?.market === 'futures';
  const sizeLabel = isFutures ? t.contracts : t.lots;
  const currentSize = parseDecimal(size);
  const step = sizeStep(sizeBase ?? currentSize ?? 0, isFutures);
  const cfd = allowed.filter((i) => i.market === 'cfd');
  const futures = allowed.filter((i) => i.market === 'futures');

  return (
    <form onSubmit={submit} className="card relative flex flex-col gap-4 p-5" aria-label={trade ? t.editAria : t.newTrade}>
      <div className="flex items-center gap-3">
        <h2 className="m-0 text-[15px] font-bold">{trade ? t.edit(trade.dayLabel) : t.newTrade}</h2>
        <div className="grow" />
        {trade && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {all.common.close}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5" role="group" aria-label={t.direction}>
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
            {signalOpen ? t.hideSignal : t.pasteSignal}
          </Button>
          {signalOpen && (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label={t.signalText}
                placeholder={'XAUUSD - SELL\nIN: 4406.50\nSL: 4414\nTP1: 4390\nTP2: 4384'}
                value={signalText}
                onChange={(e) => setSignalText(e.target.value)}
                className="min-h-28"
              />
              <Button size="sm" variant="primary" onClick={loadSignal} disabled={!signalText.trim() || parseSignal.isPending}>
                {t.loadSignal}
              </Button>
            </div>
          )}
          {signalNotes.length > 0 && (
            <ul className="m-0 list-none rounded-(--radius-control) bg-raised p-3 text-[13px] text-dim">
              {signalNotes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {accounts.length > 0 && (
        <Field label={all.accounts.switcher} hint={tradeAccount ? accountKind(all, tradeAccount) : undefined}>
          <Select
            value={accountId}
            onChange={chooseAccount}
            options={[{ value: '', label: all.accounts.none }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </Field>
      )}

      <Field label={t.instrument} hint={instrument ? `${instrument.market === 'cfd' ? 'CFD' : 'Futures'} · ${all.units.name[instrument.measureUnit].toLowerCase()}` : undefined}>
        <Select
          value={instrumentId}
          onChange={setInstrumentId}
          options={[
            ...cfd.map((i) => ({ value: i.id, label: `${i.symbol} · ${i.name}`, group: 'CFD' })),
            ...futures.map((i) => ({ value: i.id, label: `${i.symbol} · ${i.name}`, group: 'Futures' })),
          ]}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t.opened} className="col-span-2">
          <Input type="datetime-local" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} required />
        </Field>
        <Field label={t.closed} className="col-span-2">
          <Input type="datetime-local" value={closedAt} onChange={(e) => setClosedAt(e.target.value)} />
        </Field>
        <Field label={t.entry}>
          <Input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} required />
        </Field>
        <Field label={t.exit}>
          <Input inputMode="decimal" value={exit} onChange={(e) => setExit(e.target.value)} placeholder={all.common.open} />
        </Field>
        <Field label={t.stopLoss}>
          <Input inputMode="decimal" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </Field>
        <Field label={t.takeProfit}>
          <Input inputMode="decimal" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <Field label={sizeLabel} hint={isFutures ? t.wholeContracts : t.anySize}>
          <Input
            inputMode={isFutures ? 'numeric' : 'decimal'}
            value={size}
            onChange={(e) => setSize(isFutures ? e.target.value.replace(/\D/g, '') : e.target.value)}
            required
          />
        </Field>
        <div role="group" aria-label={t.quickSize(sizeLabel.toLowerCase())} className="flex gap-1.5">
          {(isFutures ? FUTURES_SIZES : CFD_SIZES).map((preset) => {
            const active = parseDecimal(size) === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => setSize(priceText(preset))}
                className={`h-9 grow font-mono text-[13px] ${toggleClass(active)}`}
              >
                {priceText(preset)}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={!currentSize}
            onClick={() => currentSize && setSize(priceText(roundSize(currentSize * 2)))}
            className={`h-9 flex-1 font-mono text-[13px] ${toggleClass(false)} disabled:opacity-40`}
          >
            ×2
          </button>
          <button
            type="button"
            disabled={!currentSize}
            onClick={() => currentSize && setSizeText(priceText(roundSize(currentSize + step)))}
            className={`h-9 flex-1 font-mono text-[13px] ${toggleClass(false)} disabled:opacity-40`}
          >
            +{priceText(step)}
          </button>
        </div>
      </div>

      {instrument && !sameCurrency && (
        <Field label={t.fxRate(`${instrument.quoteCurrency}/${account}`)} hint={t.fxHint}>
          <Input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="auto" />
        </Field>
      )}

      {isCfd && spread.data && (
        <div className={`flex flex-col gap-2.5 p-3.5 rounded-(--radius-control) ${askSpread ? 'border border-dashed border-accent bg-accent/5' : 'bg-raised'}`}>
          <span className="text-[13px] font-semibold">
            {askSpread
              ? t.spreadAsk(instrument?.symbol ?? '', tradeDate === toLocalDate(new Date(), user.settings.timezone) || !tradeDate ? t.today : formatDate(tradeDate))
              : t.spreadDay(instrument?.symbol ?? '')}
          </span>
          {askSpread ? (
            <div className="flex items-end gap-2">
              <Field label={all.units.name[instrument!.measureUnit]} className="grow">
                <Input inputMode="decimal" value={spreadText} onChange={(e) => setSpreadText(e.target.value)} placeholder={t.spreadPlaceholder} />
              </Field>
              {spread.data.suggestion && (
                <span className="flex h-11 items-center rounded-(--radius-control) bg-chip px-2.5 font-mono text-xs whitespace-nowrap text-dim">
                  {t.lastSpread(formatNumber(spread.data.suggestion.spread), formatDate(spread.data.suggestion.date).slice(0, 5))}
                </span>
              )}
            </div>
          ) : (
            <span className="font-mono text-sm text-dim">
              {formatNumber(spread.data.spread)} {unit}
            </span>
          )}
          {askSpread && <span className="text-xs text-dim">{t.spreadSaveInfo}</span>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t.source}</span>
        <Segmented
          label={t.sourceAria}
          value={source}
          onChange={setSource}
          options={[
            { value: 'own', label: t.own },
            { value: 'educator', label: t.educator },
          ]}
        />
        {source === 'educator' && (
          <div className="flex flex-col gap-2">
            <Select
              aria-label={t.educator}
              value={educatorId}
              onChange={setEducatorId}
              options={[{ value: '', label: t.chooseEducator }, ...(educators.data ?? []).map((ed) => ({ value: ed.id, label: ed.displayName }))]}
            />
            {user.role === 'admin' && (
              <div className="flex gap-2">
                <Input aria-label={t.newEducator} placeholder={t.addEducator} value={newEducator} onChange={(e) => setNewEducator(e.target.value)} />
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
                  {t.add}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="eyebrow mb-2">{t.emotions}</legend>
        <div className="flex flex-wrap gap-1.5">
          {emotions.data?.map((em) => {
            const checked = emotionKeys.includes(em.key);
            return (
              <label
                key={em.key}
                className={`flex h-9 cursor-pointer items-center rounded-full! px-3.5 text-[13px] has-focus-visible:outline-2 has-focus-visible:outline-accent-ink ${toggleClass(checked)}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => setEmotionKeys((keys) => (checked ? keys.filter((k) => k !== em.key) : [...keys, em.key]))}
                />
                {em.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Field label={t.notes}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10_000} className="font-sans" />
      </Field>

      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t.screenshots}</span>
        {trade && trade.screenshots.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
            {trade.screenshots.map((shot) => (
              <li key={shot.id} className="relative">
                <a href={shot.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-(--radius-control) border border-line">
                  <img src={shot.url} alt={t.screenshotAlt} className="block aspect-video w-full object-cover" />
                </a>
                <button
                  type="button"
                  aria-label={t.removeScreenshot}
                  onClick={() => removeShot.mutate({ tradeId: trade.id, screenshotId: shot.id })}
                  className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-lg bg-panel/90 text-sell shadow-sm"
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
          aria-label={t.addScreenshots}
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
          className="text-sm text-dim file:mr-3 file:h-9 file:cursor-pointer file:rounded-(--radius-chip) file:border file:border-line file:bg-panel file:px-3 file:font-sans file:text-[13px] file:font-semibold file:text-ink"
        />
      </div>

      {preview && (
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-(--radius-control) bg-raised p-3.5 font-mono text-[13px]">
          <dt className="text-dim">{t.result}</dt>
          <dd className={`m-0 text-right ${(preview.resultUnits ?? 0) >= 0 ? 'text-buy' : 'text-sell'}`}>
            {preview.resultUnits == null ? all.common.open : `${formatNumber(preview.resultUnits, true)} ${unit}`}
          </dd>
          <dt className="text-dim">{t.inCurrency}</dt>
          <dd className="m-0 text-right">
            {preview.pnlAccount != null
              ? `${formatMoney(preview.pnlAccount)} ${account}`
              : preview.pnlQuote != null
                ? `${formatMoney(preview.pnlQuote)} ${instrument?.quoteCurrency}`
                : '—'}
          </dd>
          <dt className="text-dim">{t.risk}</dt>
          <dd className="m-0 text-right">
            {preview.riskUnits == null ? '—' : `${formatNumber(preview.riskUnits)} ${unit}`}
            {riskMoney != null && ` · ${formatMoney(riskMoney, false)} ${account}`}
            {riskMoney != null && balance != null && balance > 0 && (
              <span className="block text-dim">{t.riskOfBalance(`${formatNumber((riskMoney / balance) * 100)}%`)}</span>
            )}
          </dd>
          {margin != null && leverage != null && (
            <>
              <dt className="text-dim">{t.margin(leverage)}</dt>
              <dd className="m-0 text-right">
                {formatMoney(margin, false)} {account}
              </dd>
            </>
          )}
          <dt className="text-dim">{t.rPlan}</dt>
          <dd className="m-0 text-right">
            {formatNumber(preview.rMultiple, true)} R · {formatNumber(preview.plannedRR)}
          </dd>
        </dl>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={busy}>
        {busy ? t.saving : trade ? t.saveChanges : t.addTrade}
      </Button>
      {trade && (
        <Button variant="danger" onClick={remove} disabled={deleteTrade.isPending}>
          {t.deleteTrade}
        </Button>
      )}
    </form>
  );
}
