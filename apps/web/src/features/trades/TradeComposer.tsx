import type { AccountSummary, Instrument, PublicUser, Trade, TradeMutation } from '@trading/api/types';
import {
  AUTO_FX_CURRENCIES,
  canSplit,
  computeTradeMetrics,
  isWholeSteps,
  marginQuote,
  priceToUnits,
  riskQuote,
  sizeForRisk,
  sizeStep,
  toLocalDate,
  tradeSession,
  type CreateTradeInput,
  type Direction,
  type TradePartInput,
  type TradeSource,
} from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import {
  useCreateEducator,
  useDailySpread,
  useDeleteScreenshot,
  useDeleteTrade,
  useEducators,
  useEmotions,
  useFxRate,
  useParseSignal,
  useSaveSpread,
  useSaveTrade,
  useStrategies,
  useUploadScreenshot,
} from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { DateTimePicker } from '../../components/ui/DateTimePicker.tsx';
import { Field, Input, Segmented, Textarea, toggleClass } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatAmount, formatDate, formatNumber, formatPrice, parseDecimal, toDateTimeLocal, toInputNumber } from '../../lib/format.ts';
import { instrumentOptions } from '../../lib/instruments.ts';
import { emptyPart, PartsEditor, partsTotal, ResultPicker, splitEqually, type PartDraft } from './PartsEditor.tsx';
import { PositionSize, type RiskMode } from './PositionSize.tsx';
import { onlyImages, ScreenshotDrop } from './ScreenshotDrop.tsx';

/** The last choices, so the next trade needs fewer clicks (per browser). */
const DEFAULTS_KEY = 'trade-composer-defaults';
interface Remembered {
  accountId?: string;
  instrumentId?: string;
  riskMode?: RiskMode;
  riskText?: string;
  strategyId?: string;
  /** The last size per instrument. */
  sizes?: Record<string, string>;
}
const readDefaults = (): Remembered => {
  try {
    return JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? '{}') as Remembered;
  } catch {
    return {};
  }
};
const writeDefaults = (patch: Remembered) => {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ ...readDefaults(), ...patch }));
  } catch {
    // Without storage the form simply starts from the defaults.
  }
};

const localTime = (iso: string | null | undefined) => (iso ? toDateTimeLocal(new Date(iso)) : '');
const toIso = (local: string) => new Date(local).toISOString();

interface Props {
  user: PublicUser;
  instruments: Instrument[];
  accounts: AccountSummary[];
  /** Edit mode when set. */
  trade?: Trade;
  /** Account picked in the account switcher ('' = all). */
  preferredAccountId?: string;
  onSaved: (result: TradeMutation, mode: 'created' | 'updated') => void;
  onCancel?: () => void;
  onDeleted?: () => void;
}

/** Parts of a saved trade as drafts; a part's stop shows only where it differs from the one before. */
function draftsOf(trade: Trade): PartDraft[] {
  let previous = trade.stopLoss;
  return trade.parts.map((p) => {
    const slText = p.stopLoss != null && p.stopLoss !== previous ? toInputNumber(p.stopLoss) : '';
    previous = p.stopLoss ?? previous;
    return {
      sizeText: toInputNumber(p.size),
      tpText: toInputNumber(p.takeProfit),
      slText,
      result: p.result,
      priceText: p.result === 'manual' ? toInputNumber(p.price) : '',
      closedAt: localTime(p.closedAt),
    };
  });
}

/**
 * Adds or edits a trade, in the order a trader thinks of it: what and when, how big, the levels, how
 * it ended (as a whole or in parts), then the psychology. The size comes from presets, ×2 and +step
 * or from the risk; a summary of risk, planned RR and result is always in view. Screenshots can be
 * dropped or pasted anywhere in the form.
 */
export function TradeComposer({ user, instruments, accounts, trade, preferredAccountId, onSaved, onCancel, onDeleted }: Props) {
  const all = useT();
  const t = all.composer;
  const f = all.form;
  const account = user.settings.accountCurrency;
  const remembered = trade ? {} : readDefaults();

  const [direction, setDirection] = useState<Direction>(trade?.direction ?? 'long');
  const [accountId, setAccountId] = useState(() => {
    if (trade) return trade.accountId ?? '';
    const pick = [preferredAccountId, remembered.accountId].find((id) => id && accounts.some((a) => a.id === id));
    return pick ?? (accounts.length === 1 ? accounts[0]!.id : '');
  });
  const tradeAccount = accounts.find((a) => a.id === accountId);
  // A prop account trades one market; the instrument list follows it.
  const allowed = tradeAccount?.market ? instruments.filter((i) => i.market === tradeAccount.market) : instruments;
  const [instrumentId, setInstrumentId] = useState(() => {
    const preferred = trade?.instrumentId ?? remembered.instrumentId;
    return allowed.find((i) => i.id === preferred)?.id ?? allowed.find((i) => i.favorite)?.id ?? allowed[0]?.id ?? '';
  });
  const [openedAt, setOpenedAt] = useState(trade ? localTime(trade.openedAt) : toDateTimeLocal(new Date()));
  const [sizeText, setSizeText] = useState(() => (trade ? toInputNumber(trade.positionSize) : (remembered.sizes?.[instrumentId] ?? '')));
  const [riskText, setRiskText] = useState(remembered.riskText ?? '1');
  const [riskMode, setRiskMode] = useState<RiskMode>(remembered.riskMode ?? 'pct');
  const [entry, setEntry] = useState(toInputNumber(trade?.entryPrice));
  const [stopText, setStopText] = useState(toInputNumber(trade?.stopLoss));
  const [split, setSplit] = useState((trade?.parts.length ?? 0) > 1);
  const [parts, setParts] = useState<PartDraft[]>(() => (trade?.parts.length ? draftsOf(trade) : [emptyPart({ tpText: toInputNumber(trade?.takeProfit) })]));
  const [strategyId, setStrategyId] = useState(trade ? (trade.strategyId ?? '') : (remembered.strategyId ?? ''));
  const [checkedRuleIds, setCheckedRuleIds] = useState<string[]>(trade?.checkedRuleIds ?? []);
  const [emotionKeys, setEmotionKeys] = useState<string[]>(trade?.emotionKeys ?? []);
  const [notes, setNotes] = useState(trade?.notes ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [fxRate, setFxRate] = useState(trade?.fxRateSource === 'manual' ? toInputNumber(trade.fxRate) : '');
  const [source, setSource] = useState<TradeSource>(trade?.source ?? 'own');
  const [educatorId, setEducatorId] = useState(trade?.educatorId ?? '');
  const [newEducator, setNewEducator] = useState('');
  const [spreadText, setSpreadText] = useState('');
  const [signalText, setSignalText] = useState('');
  const [signalNotes, setSignalNotes] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const emotions = useEmotions();
  const educators = useEducators();
  const { data: strategies = [] } = useStrategies();
  const saveTrade = useSaveTrade();
  const deleteTrade = useDeleteTrade();
  const upload = useUploadScreenshot();
  const removeShot = useDeleteScreenshot();
  const parseSignal = useParseSignal();
  const saveSpread = useSaveSpread();
  const createEducator = useCreateEducator();

  const instrument = instruments.find((i) => i.id === instrumentId);
  const isFutures = instrument?.market === 'futures';
  const isCfd = instrument?.market === 'cfd';
  const step = sizeStep(instrument?.market ?? 'cfd');
  const unitLabel = isFutures ? t.contractsShort : t.lotsShort;
  const tradeDate = openedAt ? toLocalDate(new Date(openedAt), user.settings.timezone) : undefined;
  const spread = useDailySpread(isCfd && advanced ? instrumentId : undefined, tradeDate);
  useEffect(() => {
    const suggestion = spread.data?.spread ?? spread.data?.suggestion?.spread;
    setSpreadText(suggestion == null ? '' : toInputNumber(suggestion));
  }, [spread.data]);

  const chooseInstrument = (id: string) => {
    setInstrumentId(id);
    // A new trade picks up the size last used on that instrument.
    const last = trade ? undefined : readDefaults().sizes?.[id];
    if (last) setSizeText(last);
  };
  const chooseAccount = (id: string) => {
    setAccountId(id);
    const market = accounts.find((a) => a.id === id)?.market;
    const current = instruments.find((i) => i.id === instrumentId);
    if (market && current?.market !== market) chooseInstrument(instruments.find((i) => i.market === market)?.id ?? '');
  };

  // Quote → account rate: the same automatic ECB rate the API applies, or the one typed in.
  const sameCurrency = instrument?.quoteCurrency === account;
  const autoCurrency = (c: string | undefined) => c != null && (AUTO_FX_CURRENCIES as readonly string[]).includes(c);
  const lastClose = parts.map((p) => p.closedAt).filter(Boolean).sort().at(-1);
  const fxDay = new Date(lastClose || openedAt || Date.now()).toISOString().slice(0, 10);
  const autoFx = useFxRate(!sameCurrency && fxRate.trim() === '' && autoCurrency(instrument?.quoteCurrency) && autoCurrency(account) ? instrument?.quoteCurrency : undefined, account, fxDay);
  const rate = sameCurrency ? 1 : (parseDecimal(fxRate) ?? autoFx.data?.rate ?? null);

  const entryNum = parseDecimal(entry) ?? null;
  const stop = parseDecimal(stopText) ?? null;
  const position = parseDecimal(sizeText) ?? null;
  const balance = tradeAccount?.balance ?? null;
  const splittable = canSplit(position, step);

  // The risk helper: % of the balance or an amount, turned into a size between entry and stop.
  const riskValue = parseDecimal(riskText);
  const riskTarget = riskMode === 'pct' ? (balance != null && riskValue != null ? (balance * riskValue) / 100 : null) : (riskValue ?? null);
  const sizedFromRisk = instrument && entryNum != null && riskTarget != null && rate != null ? sizeForRisk(instrument, entryNum, stop, riskTarget / rate, step) : null;
  const riskBlocker = sizedFromRisk != null ? null : stop == null || entryNum == null ? t.needStop : riskMode === 'pct' && balance == null ? t.needBalance : riskValue ? t.tooTight : '—';

  // Parts with sizes, stops (an empty stop copies the part before) and close prices.
  let previousStop = stop;
  const resolved = parts.map((p) => {
    const partStop = parseDecimal(p.slText) ?? previousStop;
    previousStop = partStop;
    const tp = parseDecimal(p.tpText) ?? null;
    const size = split ? (parseDecimal(p.sizeText) ?? null) : position;
    const price = p.result === 'tp' ? tp : p.result === 'sl' ? partStop : p.result === 'be' ? entryNum : p.result === 'manual' ? (parseDecimal(p.priceText) ?? null) : null;
    return { draft: p, size, tp, stop: partStop, price };
  });
  const closedParts = resolved.filter((r) => r.price != null && r.size != null);
  const preview =
    instrument && entryNum != null && position != null
      ? computeTradeMetrics(instrument, {
          direction,
          entryPrice: entryNum,
          stopLoss: stop,
          positionSize: position,
          fxRate: rate,
          parts: resolved.filter((r) => r.size != null).map((r) => ({ size: r.size!, price: r.price, takeProfit: r.tp })),
        })
      : null;
  // Each closed part's pips with its result ("TP +100 · BE 0"); they add up to the trade's pips.
  const partPips = split && instrument && entryNum != null ? closedParts.map((r) => `${t.results[r.draft.result]} ${formatNumber(priceToUnits(instrument, direction, entryNum, r.price!), true)}`) : [];
  const riskMoney = instrument && entryNum != null && position != null && rate != null && stop != null ? (riskQuote(instrument, { entryPrice: entryNum, stopLoss: stop, positionSize: position }) ?? 0) * rate : null;
  const leverage = tradeAccount?.leverage ?? null;
  const margin = isCfd && leverage && instrument && entryNum != null && position != null && rate != null ? marginQuote(instrument, entryNum, position, leverage) * rate : null;
  const session = openedAt ? tradeSession(new Date(openedAt)) : null;
  const strategy = strategies.find((s) => s.id === strategyId);
  const single = parts[0] ?? emptyPart();
  const updateSingle = (patch: Partial<PartDraft>) => setParts([{ ...single, ...patch }, ...parts.slice(1)]);

  const toggleSplit = () => {
    if (split) {
      setSplit(false);
      return setParts([single]);
    }
    if (!splittable || position == null) return;
    const [a, b] = splitEqually(position, 2, step);
    setSplit(true);
    setParts([{ ...single, sizeText: toInputNumber(a) }, emptyPart({ sizeText: toInputNumber(b) })]);
  };

  const addFiles = (added: File[]) => setFiles((current) => [...current, ...added]);
  // A screenshot pasted anywhere in the form (Ctrl+V / ⌘V) is added; text pastes are left alone.
  const onPaste = (e: ClipboardEvent<HTMLFormElement>) => {
    const images = onlyImages(e.clipboardData.files);
    if (images.length === 0) return;
    e.preventDefault();
    addFiles(images.map((file, i) => new File([file], file.name === 'image.png' ? `wklejony-${Date.now()}-${i}.png` : file.name, { type: file.type })));
  };

  const loadSignal = () =>
    parseSignal.mutate(signalText, {
      onSuccess: (result) => {
        if (!result.ok) return setSignalNotes(result.errors);
        const { signal } = result;
        if (result.instrument) chooseInstrument(result.instrument.id);
        setDirection(signal.direction);
        setEntry(toInputNumber(signal.entryPrice));
        setStopText(toInputNumber(signal.stopLoss));
        setSource('educator');
        // Several take profits become parts, split equally when the size allows it.
        const tps = signal.takeProfits.length ? signal.takeProfits : [null];
        const many = tps.length > 1 && position != null && position >= tps.length * step - 1e-9;
        const sizes = many ? splitEqually(position!, tps.length, step) : [];
        setSplit(many);
        setParts(many ? tps.map((tp, i) => emptyPart({ tpText: toInputNumber(tp), sizeText: toInputNumber(sizes[i]) })) : [emptyPart({ tpText: toInputNumber(tps[0]) })]);
        setSignalNotes([f.signalLoaded(signal.symbol, signal.direction.toUpperCase(), false), ...result.warnings]);
      },
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors([]);
    if (!accountId) return setErrors([f.errAccount]);
    if (!instrument || entryNum == null) return setErrors([t.errEntry]);
    if (position == null || position <= 0) return setErrors([t.errSize]);
    if (isFutures && !Number.isInteger(position)) return setErrors([f.errFutures]);
    if (split) {
      if (Math.abs(partsTotal(parts) - position) > 1e-6) return setErrors([t.errSplit(formatNumber(position), unitLabel)]);
      const bad = resolved.findIndex((r) => r.size == null || r.size < step || !isWholeSteps(r.size, step));
      if (bad >= 0) return setErrors([t.errPartStep(bad + 1, formatNumber(step))]);
    }
    if (resolved.some((r) => r.draft.result === 'manual' && r.price == null)) return setErrors([t.errExitPrice]);
    if (source === 'educator' && !educatorId) return setErrors([f.errEducator]);
    const now = toDateTimeLocal(new Date());
    const partInput: TradePartInput[] = resolved.map((r) => ({
      size: r.size!,
      takeProfit: r.tp,
      stopLoss: r.stop,
      result: r.draft.result,
      ...(r.draft.result === 'manual' ? { price: r.price! } : {}),
      closedAt: r.draft.result === 'open' ? null : toIso(r.draft.closedAt || now),
    }));

    try {
      const spreadValue = parseDecimal(spreadText);
      if (advanced && isCfd && spread.data?.askUser && spreadValue != null && tradeDate) {
        await saveSpread.mutateAsync({ instrumentId, date: tradeDate, spread: spreadValue });
      }
      const input: Partial<CreateTradeInput> = {
        instrumentId,
        direction,
        openedAt: toIso(openedAt),
        entryPrice: entryNum,
        stopLoss: stop,
        takeProfits: resolved.map((r) => r.tp).filter((tp): tp is number => tp != null),
        positionSize: position,
        parts: partInput,
        accountId,
        strategyId: strategyId || null,
        checkedRuleIds: strategyId ? checkedRuleIds : [],
        emotionKeys,
        notes: notes.trim() || null,
        fxRate: parseDecimal(fxRate) ?? null,
        source,
        educatorId: source === 'educator' ? educatorId : null,
        signalId: source === 'educator' ? (trade?.signalId ?? null) : null,
      };
      const result = await saveTrade.mutateAsync({ id: trade?.id, input });
      for (const file of files) await upload.mutateAsync({ tradeId: result.trade.id, file });
      if (!trade) writeDefaults({ accountId, instrumentId, riskMode, riskText, strategyId, sizes: { ...readDefaults().sizes, [instrumentId]: sizeText } });
      onSaved(result, trade ? 'updated' : 'created');
    } catch (err) {
      setErrors(err instanceof ApiError ? err.lines : [(err as Error).message]);
    }
  };

  const busy = saveTrade.isPending || upload.isPending || saveSpread.isPending;
  const unit = instrument ? all.units.short[instrument.measureUnit] : '';
  const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'text-buy' : 'text-sell');

  if (accounts.length === 0) {
    return (
      <p role="alert" className="m-0 rounded-(--radius-control) bg-warn-bg p-4 text-[13px]">
        {f.noAccounts}{' '}
        <Link to="/ustawienia/$section" params={{ section: 'konta' }} className="font-semibold text-accent-ink">
          {f.addAccount}
        </Link>
      </p>
    );
  }

  return (
    <form onSubmit={submit} onPaste={onPaste} aria-label={trade ? f.editAria : t.title} className="flex flex-col gap-5">
      {/* 1. What and when; the session follows from the time. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <Group label={f.direction}>
          <div className="flex gap-1.5" role="group" aria-label={f.direction}>
            <Button variant="buy" size="md" selected={direction === 'long'} onClick={() => setDirection('long')} className="w-20">
              BUY
            </Button>
            <Button variant="sell" size="md" selected={direction === 'short'} onClick={() => setDirection('short')} className="w-20">
              SELL
            </Button>
          </div>
        </Group>
        <Field label={f.instrument}>
          <Select value={instrumentId} onChange={chooseInstrument} options={instrumentOptions(allowed, { label: (i) => `${i.symbol} · ${i.name}`, favorites: all.instruments.favorites, others: all.instruments.others })} />
        </Field>
        <Field label={all.accounts.switcher}>
          <Select value={accountId} onChange={chooseAccount} options={[...(accountId ? [] : [{ value: '', label: f.chooseAccount }]), ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        </Field>
        <Field label={t.opened} hint={session ? <span className="font-semibold text-accent-ink">{all.tradeSessions[session]}</span> : undefined}>
          <DateTimePicker value={openedAt} onChange={setOpenedAt} />
        </Field>
      </div>

      {/* 2. Size: presets, ×2, +step, or from the risk. */}
      <Group label={t.size}>
        <PositionSize
          value={sizeText}
          onChange={(text) => {
            setSizeText(text);
            if (!canSplit(parseDecimal(text) ?? null, step) && split) {
              setSplit(false);
              setParts([single]);
            }
          }}
          isFutures={isFutures}
          unitLabel={unitLabel}
          riskText={riskText}
          onRiskText={setRiskText}
          riskMode={riskMode}
          onRiskMode={setRiskMode}
          sizedFromRisk={sizedFromRisk}
          riskBlocker={riskBlocker}
          currencySymbol={currencySymbol(account)}
        />
      </Group>

      {/* 3. Levels. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={f.entry}>
          <Input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="0,00" className="font-semibold" />
        </Field>
        <Field label={t.stopLoss}>
          <Input inputMode="decimal" value={stopText} onChange={(e) => setStopText(e.target.value)} placeholder="—" />
        </Field>
        <Field label={t.takeProfit} hint={split ? t.tpInParts : undefined}>
          <Input inputMode="decimal" value={split ? '' : single.tpText} onChange={(e) => updateSingle({ tpText: e.target.value })} placeholder={split ? '↓' : '—'} disabled={split} />
        </Field>
      </div>

      {/* 4. How it ended: as a whole, or part by part. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {!split && (
            <>
              <Group label={t.outcome}>
                <ResultPicker label={t.outcome} value={single.result} onChange={(result) => updateSingle({ result })} />
              </Group>
              {single.result === 'manual' && (
                <Field label={t.closePrice} className="w-36">
                  <Input inputMode="decimal" value={single.priceText} onChange={(e) => updateSingle({ priceText: e.target.value })} />
                </Field>
              )}
              {single.result !== 'open' && (
                <Field label={t.closedAt} className="w-52">
                  <DateTimePicker value={single.closedAt} onChange={(closedAt) => updateSingle({ closedAt })} clearable placeholder={t.closedNow} />
                </Field>
              )}
            </>
          )}
          {split && <span className="eyebrow">{t.parts}</span>}
          <span className="grow" />
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              aria-pressed={split}
              onClick={toggleSplit}
              disabled={!split && !splittable}
              className={`flex h-11 items-center gap-2 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${toggleClass(split)}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                {split ? <path d="M4 12h16" /> : <path d="M4 7h16M4 12h10M4 17h6" />}
              </svg>
              {split ? t.splitOff : t.splitOn}
            </button>
            {!split && !splittable && <span className="text-[11px] text-dim">{t.splitTooSmall(formatNumber(2 * step), unitLabel)}</span>}
          </div>
        </div>
        {split && <PartsEditor parts={parts} onChange={setParts} total={position} step={step} unitLabel={unitLabel} isFutures={isFutures} tradeStop={stopText} />}
      </div>

      {/* 5. What it comes to; per-part pips only here. Always in view, with dashes until known. */}
      <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-(--radius-control) border border-line bg-line text-[13px] lg:grid-cols-4">
        <Metric label={t.risk}>
          {preview?.riskUnits == null ? (
            '—'
          ) : (
            <>
              {formatNumber(preview.riskUnits)} {unit}
              {riskMoney ? <span className="text-dim"> · {formatAmount(riskMoney, account, false)}</span> : null}
              {riskMoney && balance ? <span className="text-dim"> · {formatNumber((riskMoney / balance) * 100)}%</span> : null}
            </>
          )}
        </Metric>
        <Metric label={t.plannedRR}>{preview?.plannedRR == null ? '—' : `1 : ${formatNumber(preview.plannedRR)}`}</Metric>
        <Metric label={t.result}>
          {!preview || closedParts.length === 0 ? (
            <span className="text-dim">{preview ? all.common.open : '—'}</span>
          ) : (
            <>
              <span className={`font-semibold ${tone(preview.pnlAccount ?? preview.pnlQuote)}`}>
                {preview.pnlAccount != null ? formatAmount(preview.pnlAccount, account) : formatAmount(preview.pnlQuote, instrument?.quoteCurrency)}
              </span>
              <span className="text-dim">
                {' · '}
                {partPips.length > 1 ? `${partPips.join(' + ')} = ` : ''}
                {formatNumber(preview.resultUnits, true)} {unit} · {formatNumber(preview.rMultiple, true)} R
              </span>
            </>
          )}
        </Metric>
        <Metric label={leverage != null && isCfd ? f.margin(leverage) : t.margin}>{margin != null ? formatAmount(margin, account, false) : '—'}</Metric>
      </dl>

      {/* 6. Psychology and context, always in view. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold">{f.emotions}</legend>
          <div className="flex flex-wrap gap-1.5">
            {emotions.data?.map((em) => {
              const checked = emotionKeys.includes(em.key);
              return (
                <label key={em.key} className={`flex h-9 cursor-pointer items-center rounded-full! px-3.5 text-[13px] has-focus-visible:outline-2 has-focus-visible:outline-accent-ink ${toggleClass(checked)}`}>
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => setEmotionKeys((keys) => (checked ? keys.filter((k) => k !== em.key) : [...keys, em.key]))} />
                  {em.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <Field label={f.notes}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10_000} rows={3} className="min-h-0 font-sans" />
        </Field>
        <ScreenshotDrop
          saved={trade?.screenshots ?? []}
          onRemoveSaved={(id) => trade && removeShot.mutate({ tradeId: trade.id, screenshotId: id })}
          pending={files}
          onAdd={addFiles}
          onRemovePending={(i) => setFiles((current) => current.filter((_, j) => j !== i))}
        />
        {strategies.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold">{t.strategy}</span>
              <div className="w-56">
                <Select
                  aria-label={t.strategy}
                  value={strategyId}
                  onChange={(id) => {
                    setStrategyId(id);
                    setCheckedRuleIds([]);
                  }}
                  options={[{ value: '', label: t.noStrategy }, ...strategies.map((s) => ({ value: s.id, label: s.name }))]}
                />
              </div>
              {strategy && <span className="font-mono text-xs text-dim">{t.rulesKept(checkedRuleIds.length, strategy.rules.length)}</span>}
            </div>
            {strategy && strategy.rules.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {strategy.rules.map((rule) => {
                  const on = checkedRuleIds.includes(rule.id);
                  return (
                    <button key={rule.id} type="button" aria-pressed={on} onClick={() => setCheckedRuleIds(on ? checkedRuleIds.filter((id) => id !== rule.id) : [...checkedRuleIds, rule.id])} className={`rounded-full px-3 py-1.5 text-xs ${toggleClass(on)}`}>
                      {on ? '✓ ' : ''}
                      {rule.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 7. Advanced: signal, source, spread, rate. */}
      <div className="flex flex-col gap-3">
        <Button size="sm" variant="ghost" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)} className="self-start">
          {advanced ? '− ' : '+ '}
          {t.advanced}
        </Button>
        {advanced && (
          <div className="grid gap-4 rounded-(--radius-control) border border-line p-4 lg:grid-cols-2">
            {!trade && (
              <div className="flex flex-col gap-2">
                <span className="eyebrow">{f.pasteSignal}</span>
                <Textarea aria-label={f.signalText} placeholder={'XAUUSD - SELL\nIN: 4406.50\nSL: 4414\nTP1: 4390\nTP2: 4384'} value={signalText} onChange={(e) => setSignalText(e.target.value)} className="min-h-24" />
                <Button size="sm" onClick={loadSignal} disabled={!signalText.trim() || parseSignal.isPending} className="self-start">
                  {f.loadSignal}
                </Button>
                {signalNotes.length > 0 && (
                  <ul className="m-0 list-none text-[13px] text-dim">
                    {signalNotes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <span className="eyebrow">{f.source}</span>
                <Segmented label={f.sourceAria} value={source} onChange={setSource} options={[{ value: 'own', label: f.own }, { value: 'educator', label: f.educator }]} />
                {source === 'educator' && (
                  <>
                    <Select aria-label={f.educator} value={educatorId} onChange={setEducatorId} options={[{ value: '', label: f.chooseEducator }, ...(educators.data ?? []).map((ed) => ({ value: ed.id, label: ed.displayName }))]} />
                    {user.role === 'admin' && (
                      <div className="flex gap-2">
                        <Input aria-label={f.newEducator} placeholder={f.addEducator} value={newEducator} onChange={(e) => setNewEducator(e.target.value)} />
                        <Button size="md" disabled={!newEducator.trim() || createEducator.isPending} onClick={() => createEducator.mutate(newEducator.trim(), { onSuccess: (ed) => (setEducatorId(ed.id), setNewEducator('')) })}>
                          {f.add}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
              {isCfd && spread.data && (
                <Field label={t.spread(instrument?.symbol ?? '')} hint={spread.data.suggestion ? f.lastSpread(formatNumber(spread.data.suggestion.spread), formatDate(spread.data.suggestion.date).slice(0, 5)) : undefined}>
                  <Input inputMode="decimal" value={spreadText} onChange={(e) => setSpreadText(e.target.value)} placeholder={unit} disabled={!spread.data.askUser} />
                </Field>
              )}
              {instrument && !sameCurrency && (
                <Field label={f.fxRate(`${instrument.quoteCurrency}/${account}`)} hint={f.fxHint}>
                  <Input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder={autoFx.data ? `auto · ${formatPrice(autoFx.data.rate)}` : 'auto'} />
                </Field>
              )}
            </div>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? f.saving : trade ? f.saveChanges : t.save}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {all.common.cancel}
          </Button>
        )}
        <span className="grow" />
        {trade && onDeleted && (
          <Button variant="danger" size="sm" disabled={deleteTrade.isPending} onClick={() => window.confirm(f.confirmDelete(trade.dayLabel)) && deleteTrade.mutate(trade.id, { onSuccess: onDeleted })}>
            {f.deleteTrade}
          </Button>
        )}
      </div>
    </form>
  );
}

/** A label over a group of buttons (a <label> would only reach the first one). */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-panel px-3 py-2.5 sm:px-4">
      <dt className="text-[11px] text-dim">{label}</dt>
      <dd className="m-0 font-mono">{children}</dd>
    </div>
  );
}

/** "$" for USD (as amounts are written), the code otherwise. */
const currencySymbol = (currency: string) => (currency === 'USD' ? '$' : currency);
