import type { AccountSummary, Instrument, PublicUser, Trade, TradeMutation } from '@trading/api/types';
import {
  AUTO_FX_CURRENCIES,
  computeTradeMetrics,
  marginQuote,
  priceToUnits,
  riskQuote,
  sizeForRisk,
  toLocalDate,
  tradeSession,
  type CreateTradeInput,
  type Direction,
  type TradePartInput,
  type TradeSource,
} from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import { emptyPart, PartsEditor, partsTotal, splitInTwo, type PartDraft } from './PartsEditor.tsx';

type SizeMode = 'lots' | 'pct' | 'money';

/** The last choices, so the next trade needs fewer clicks (per browser). */
const DEFAULTS_KEY = 'trade-composer-defaults';
interface Remembered {
  accountId?: string;
  instrumentId?: string;
  sizeMode?: SizeMode;
  riskText?: string;
  strategyId?: string;
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

/**
 * Adds or edits a trade. The total size comes first; then take profit, stop loss and the result,
 * for the whole position or, closed in parts, for each part (a part copies the previous stop).
 * Emotions, notes and screenshots are always in view; source, spread and FX rate under "Advanced".
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
  const chooseAccount = (id: string) => {
    setAccountId(id);
    const market = accounts.find((a) => a.id === id)?.market;
    const current = instruments.find((i) => i.id === instrumentId);
    if (market && current?.market !== market) setInstrumentId(instruments.find((i) => i.market === market)?.id ?? '');
  };
  const [openedAt, setOpenedAt] = useState(trade ? localTime(trade.openedAt) : toDateTimeLocal(new Date()));
  const [entry, setEntry] = useState(toInputNumber(trade?.entryPrice));
  const [sizeMode, setSizeMode] = useState<SizeMode>(trade ? 'lots' : (remembered.sizeMode ?? 'lots'));
  const [sizeText, setSizeText] = useState(toInputNumber(trade?.positionSize));
  const [riskText, setRiskText] = useState(remembered.riskText ?? '1');
  const [split, setSplit] = useState((trade?.parts.length ?? 0) > 1);
  const [parts, setParts] = useState<PartDraft[]>(() =>
    trade?.parts.length
      ? trade.parts.map((p) => ({
          sizeText: toInputNumber(p.size),
          tpText: toInputNumber(p.takeProfit),
          slText: toInputNumber(p.stopLoss),
          result: p.result,
          priceText: p.result === 'manual' ? toInputNumber(p.price) : '',
          closedAt: localTime(p.closedAt),
        }))
      : [emptyPart()],
  );
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
  const step = isFutures ? 1 : 0.01;
  const unitLabel = isFutures ? t.contractsShort : t.lotsShort;
  const tradeDate = openedAt ? toLocalDate(new Date(openedAt), user.settings.timezone) : undefined;
  const spread = useDailySpread(isCfd && advanced ? instrumentId : undefined, tradeDate);
  useEffect(() => {
    const suggestion = spread.data?.spread ?? spread.data?.suggestion?.spread;
    setSpreadText(suggestion == null ? '' : toInputNumber(suggestion));
  }, [spread.data]);

  // Quote → account rate: the same automatic ECB rate the API applies, or the one typed in.
  const sameCurrency = instrument?.quoteCurrency === account;
  const autoCurrency = (c: string | undefined) => c != null && (AUTO_FX_CURRENCIES as readonly string[]).includes(c);
  const lastClose = parts.map((p) => p.closedAt).filter(Boolean).sort().at(-1);
  const fxDay = new Date(lastClose || openedAt || Date.now()).toISOString().slice(0, 10);
  const autoFx = useFxRate(!sameCurrency && fxRate.trim() === '' && autoCurrency(instrument?.quoteCurrency) && autoCurrency(account) ? instrument?.quoteCurrency : undefined, account, fxDay);
  const rate = sameCurrency ? 1 : (parseDecimal(fxRate) ?? autoFx.data?.rate ?? null);

  const entryNum = parseDecimal(entry) ?? null;
  // The first part's stop is the trade's initial risk.
  const firstStop = parseDecimal(parts[0]?.slText ?? '') ?? null;
  const balance = tradeAccount?.balance ?? null;

  // Total size: typed, or worked out from the risk (% of the balance or an amount) and the stop.
  const riskValue = parseDecimal(riskText);
  const riskMoneyTarget = sizeMode === 'pct' ? (balance != null && riskValue != null ? (balance * riskValue) / 100 : null) : sizeMode === 'money' ? (riskValue ?? null) : null;
  const sizedFromRisk =
    sizeMode !== 'lots' && instrument && entryNum != null && riskMoneyTarget != null && rate != null ? sizeForRisk(instrument, entryNum, firstStop, riskMoneyTarget / rate, step) : null;
  const position = sizeMode === 'lots' ? (parseDecimal(sizeText) ?? null) : sizedFromRisk;

  // Parts with sizes, stops (copied from the part before when empty) and close prices.
  let previousStop: number | null = null;
  const resolved = parts.map((p) => {
    const stop = parseDecimal(p.slText) ?? previousStop;
    previousStop = stop;
    const tp = parseDecimal(p.tpText) ?? null;
    const size = split ? (parseDecimal(p.sizeText) ?? null) : position;
    const price = p.result === 'tp' ? tp : p.result === 'sl' ? stop : p.result === 'be' ? entryNum : p.result === 'manual' ? (parseDecimal(p.priceText) ?? null) : null;
    return { draft: p, size, tp, stop, price };
  });
  const closedParts = resolved.filter((r) => r.price != null && r.size != null);
  const preview =
    instrument && entryNum != null && position != null
      ? computeTradeMetrics(instrument, {
          direction,
          entryPrice: entryNum,
          stopLoss: firstStop,
          positionSize: position,
          fxRate: rate,
          parts: resolved.filter((r) => r.size != null).map((r) => ({ size: r.size!, price: r.price, takeProfit: r.tp })),
        })
      : null;
  // Each closed part's pips with its result ("TP +100 · BE 0"); they add up to the trade's pips.
  const partPips = instrument && entryNum != null ? closedParts.map((r) => `${t.results[r.draft.result]} ${formatNumber(priceToUnits(instrument, direction, entryNum, r.price!), true)}`) : [];
  const riskMoney = instrument && entryNum != null && position != null && rate != null ? (riskQuote(instrument, { entryPrice: entryNum, stopLoss: firstStop, positionSize: position }) ?? 0) * rate : null;
  const leverage = tradeAccount?.leverage ?? null;
  const margin = isCfd && leverage && instrument && entryNum != null && position != null && rate != null ? marginQuote(instrument, entryNum, position, leverage) * rate : null;
  const session = openedAt ? tradeSession(new Date(openedAt)) : null;
  const strategy = strategies.find((s) => s.id === strategyId);

  const toggleSplit = (on: boolean) => {
    setSplit(on);
    const first = parts[0] ?? emptyPart();
    if (!on) return setParts([first]);
    const [a, b] = position ? splitInTwo(position, step) : [null, null];
    setParts([
      { ...first, sizeText: a != null ? toInputNumber(a) : '' },
      emptyPart({ slText: first.slText, sizeText: b != null ? toInputNumber(b) : '' }),
    ]);
  };

  const loadSignal = () =>
    parseSignal.mutate(signalText, {
      onSuccess: (result) => {
        if (!result.ok) return setSignalNotes(result.errors);
        const { signal } = result;
        if (result.instrument) setInstrumentId(result.instrument.id);
        setDirection(signal.direction);
        setEntry(toInputNumber(signal.entryPrice));
        setSource('educator');
        // Several take profits become parts, each with the signal's stop.
        const tps = signal.takeProfits.length ? signal.takeProfits : [null];
        setSplit(tps.length > 1);
        setParts(tps.map((tp) => emptyPart({ tpText: toInputNumber(tp), slText: toInputNumber(signal.stopLoss) })));
        setSignalNotes([f.signalLoaded(signal.symbol, signal.direction.toUpperCase(), false), ...result.warnings]);
      },
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors([]);
    if (!accountId) return setErrors([f.errAccount]);
    if (!instrument || entryNum == null) return setErrors([t.errEntry]);
    if (position == null || position <= 0) return setErrors([sizeMode === 'lots' ? t.errSize : t.errRiskSize]);
    if (isFutures && !Number.isInteger(position)) return setErrors([f.errFutures]);
    if (split && Math.abs(partsTotal(parts) - position) > 1e-6) return setErrors([t.errSplit(formatNumber(position), unitLabel)]);
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
        stopLoss: firstStop,
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
      if (!trade) writeDefaults({ accountId, instrumentId, sizeMode, riskText, strategyId });
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
    <form onSubmit={submit} aria-label={trade ? f.editAria : t.title} className="flex flex-col gap-4">
      {/* 1. What and when; the session follows from the time. */}
      <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <Field label={f.direction}>
          <div className="flex gap-1.5" role="group" aria-label={f.direction}>
            <Button variant="buy" size="md" selected={direction === 'long'} onClick={() => setDirection('long')} className="w-20">
              BUY
            </Button>
            <Button variant="sell" size="md" selected={direction === 'short'} onClick={() => setDirection('short')} className="w-20">
              SELL
            </Button>
          </div>
        </Field>
        <Field label={f.instrument}>
          <Select value={instrumentId} onChange={setInstrumentId} options={instrumentOptions(allowed, { label: (i) => `${i.symbol} · ${i.name}`, favorites: all.instruments.favorites, others: all.instruments.others })} />
        </Field>
        <Field label={all.accounts.switcher}>
          <Select value={accountId} onChange={chooseAccount} options={[...(accountId ? [] : [{ value: '', label: f.chooseAccount }]), ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        </Field>
        <Field label={t.opened} hint={session ? <span className="font-semibold text-accent-ink">{all.tradeSessions[session]}</span> : undefined}>
          <DateTimePicker value={openedAt} onChange={setOpenedAt} />
        </Field>
      </div>

      {/* 2. The whole position: size first, then the entry. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field
          label={t.totalSize}
          hint={sizeMode !== 'lots' ? <span className="font-mono">{sizedFromRisk != null ? t.sizedAs(formatNumber(sizedFromRisk), unitLabel) : firstStop == null ? t.needStop : '—'}</span> : undefined}
        >
          <div className="flex gap-1.5">
            <Segmented
              label={t.sizeMode}
              value={sizeMode}
              onChange={(m) => {
                setSizeMode(m);
                if (m === 'lots' && sizedFromRisk != null) setSizeText(toInputNumber(sizedFromRisk));
              }}
              options={[
                { value: 'lots', label: unitLabel },
                { value: 'pct', label: '%' },
                { value: 'money', label: currencySymbol(account) },
              ]}
            />
            {sizeMode === 'lots' ? (
              <Input aria-label={t.totalSize} inputMode="decimal" value={sizeText} onChange={(e) => setSizeText(isFutures ? e.target.value.replace(/\D/g, '') : e.target.value)} placeholder={isFutures ? '1' : '0,10'} className="min-w-0" />
            ) : (
              <Input aria-label={sizeMode === 'pct' ? t.riskPct : t.riskMoney} inputMode="decimal" value={riskText} onChange={(e) => setRiskText(e.target.value)} placeholder="1" className="min-w-0" />
            )}
          </div>
        </Field>
        <Field label={f.entry}>
          <Input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label={t.partialClose}>
          <label className={`flex h-11 cursor-pointer items-center gap-2.5 px-3 text-sm ${toggleClass(split)}`}>
            <input type="checkbox" checked={split} onChange={(e) => toggleSplit(e.target.checked)} className="size-4 accent-(--accent)" />
            {t.partialCloseLabel}
          </label>
        </Field>
      </div>

      {/* 3. Take profit, stop and result: for the whole position or per part. */}
      <PartsEditor parts={parts} onChange={setParts} split={split} total={position} unitLabel={unitLabel} isFutures={isFutures} />

      {/* What the numbers come to; the per-part pips only here. */}
      {preview && (
        <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2 rounded-(--radius-control) border border-line px-4 py-3 text-[13px]">
          <Metric label={t.result}>
            {closedParts.length === 0 ? (
              <span className="text-dim">{all.common.open}</span>
            ) : (
              <>
                <span className={`font-mono font-semibold ${tone(preview.pnlAccount ?? preview.pnlQuote)}`}>
                  {preview.pnlAccount != null ? formatAmount(preview.pnlAccount, account) : formatAmount(preview.pnlQuote, instrument?.quoteCurrency)}
                </span>
                <span className="font-mono text-dim">
                  {' · '}
                  {partPips.length > 1 ? `${partPips.join(' · ')} = ` : ''}
                  {formatNumber(preview.resultUnits, true)} {unit} · {formatNumber(preview.rMultiple, true)} R
                </span>
              </>
            )}
          </Metric>
          <Metric label={f.risk}>
            <span className="font-mono">
              {preview.riskUnits == null ? '—' : `${formatNumber(preview.riskUnits)} ${unit}`}
              {riskMoney ? ` · ${formatAmount(riskMoney, account, false)}` : ''}
              {riskMoney && balance ? ` · ${formatNumber((riskMoney / balance) * 100)}%` : ''}
            </span>
          </Metric>
          <Metric label={t.plannedRR}>
            <span className="font-mono">{preview.plannedRR == null ? '—' : `1 : ${formatNumber(preview.plannedRR)}`}</span>
          </Metric>
          {margin != null && leverage != null && (
            <Metric label={f.margin(leverage)}>
              <span className="font-mono">{formatAmount(margin, account, false)}</span>
            </Metric>
          )}
        </dl>
      )}

      {/* 4. Psychology and context, always in view. */}
      <div className="grid gap-4 lg:grid-cols-2">
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
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">{f.screenshots}</span>
          {trade && trade.screenshots.length > 0 && (
            <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0">
              {trade.screenshots.map((shot) => (
                <li key={shot.id} className="relative">
                  <a href={shot.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-(--radius-control) border border-line">
                    <img src={shot.url} alt={f.screenshotAlt} className="block aspect-video w-full object-cover" />
                  </a>
                  <button type="button" aria-label={f.removeScreenshot} onClick={() => removeShot.mutate({ tradeId: trade.id, screenshotId: shot.id })} className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-lg bg-panel/90 text-sell shadow-sm">
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
            aria-label={f.addScreenshots}
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
            className="text-sm text-dim file:mr-3 file:h-9 file:cursor-pointer file:rounded-(--radius-chip) file:border file:border-line file:bg-panel file:px-3 file:font-sans file:text-[13px] file:font-semibold file:text-ink"
          />
        </div>
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

      {/* 5. Advanced: signal, source, spread, rate. */}
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

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-dim">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

/** "$" for USD (as amounts are written), the code otherwise. */
const currencySymbol = (currency: string) => (currency === 'USD' ? '$' : currency);
