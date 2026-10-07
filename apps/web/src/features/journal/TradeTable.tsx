import type { AccountSummary, Instrument, Trade } from '@trading/api/types';
import { DIRECTIONS, exitReason } from '@trading/shared';
import type { TradeQuery } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale, formatAmount, formatNumber, formatPrice, formatUnits } from '../../lib/format.ts';
import { InstrumentBadge } from '../../components/ui/InstrumentBadge.tsx';
import { instrumentOptions } from '../../lib/instruments.ts';
import { DateTimePicker } from '../../components/ui/DateTimePicker.tsx';
import { Fragment, type ReactNode } from 'react';

export function TradeFilters({
  value,
  onChange,
  instruments,
}: {
  value: TradeQuery;
  onChange: (next: TradeQuery) => void;
  instruments: Instrument[];
}) {
  const all = useT();
  const t = all.table;
  const set = (patch: Partial<TradeQuery>) => onChange({ ...value, ...patch });
  const num = (text: string) => (text === '' ? undefined : Number(text));
  const active = Object.values(value).some((v) => v !== undefined && v !== '');

  return (
    <div className="grid grid-cols-2 gap-3 px-5 pt-1 pb-5 md:grid-cols-4">
      <Field label={t.instrument}>
        <Select
          value={value.instrumentId ?? ''}
          onChange={(v) => set({ instrumentId: v || undefined })}
          options={[{ value: '', label: all.common.all }, ...instrumentOptions(instruments, { label: (i) => i.symbol, favorites: all.instruments.favorites, others: all.instruments.others })]}
        />
      </Field>
      <Field label={t.direction}>
        <Select
          value={value.direction ?? ''}
          onChange={(v) => set({ direction: (v || undefined) as TradeQuery['direction'] })}
          options={[{ value: '', label: all.common.both }, ...DIRECTIONS.map((d) => ({ value: d, label: d.toUpperCase() }))]}
        />
      </Field>
      <Field label={t.status}>
        <Select
          value={value.status ?? ''}
          onChange={(v) => set({ status: (v || undefined) as TradeQuery['status'] })}
          options={[
            { value: '', label: all.common.all },
            { value: 'open', label: t.openTrades },
            { value: 'closed', label: t.closedTrades },
          ]}
        />
      </Field>
      <Field label={t.dateFrom}>
        <DateTimePicker mode="date" clearable value={value.dateFrom ?? ''} onChange={(v) => set({ dateFrom: v || undefined })} />
      </Field>
      <Field label={t.dateTo}>
        <DateTimePicker mode="date" clearable value={value.dateTo ?? ''} onChange={(v) => set({ dateTo: v || undefined })} />
      </Field>
      <Field label={t.priceRange}>
        <div className="flex gap-1">
          <Input aria-label={t.priceFrom} type="number" step="any" value={value.priceMin ?? ''} onChange={(e) => set({ priceMin: num(e.target.value) })} />
          <Input aria-label={t.priceTo} type="number" step="any" value={value.priceMax ?? ''} onChange={(e) => set({ priceMax: num(e.target.value) })} />
        </div>
      </Field>
      <Field label={t.sizeRange}>
        <div className="flex gap-1">
          <Input aria-label={t.sizeFrom} type="number" step="any" value={value.sizeMin ?? ''} onChange={(e) => set({ sizeMin: num(e.target.value) })} />
          <Input aria-label={t.sizeTo} type="number" step="any" value={value.sizeMax ?? ''} onChange={(e) => set({ sizeMax: num(e.target.value) })} />
        </div>
      </Field>
      {active && (
        <div className="col-span-full flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onChange({})}>
            {t.clearFilters}
          </Button>
        </div>
      )}
    </div>
  );
}

/** White "N" on the FinancialJuice red: a red headline came out while the trade was open. */
function RedNewsMark({ trade }: { trade: Trade }) {
  const t = useT().table;
  const titles = trade.redNews
    .map((n) => `${new Date(n.publishedAt).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' })} ${n.title}`)
    .join('\n');
  const label = t.redNews(trade.redNews.length, titles);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-breaking font-sans text-[11px] leading-none font-bold text-on-breaking"
    >
      N
    </span>
  );
}

type Outcome = 'tp' | 'sl' | 'be' | 'win' | 'loss' | 'open';

/** An average exit price shown with one decimal more than the trade's own prices (not 4004,901961). */
const roundLike = (price: number, prices: (number | null | undefined)[]) => {
  const digits = Math.max(0, ...prices.map((p) => (p == null ? 0 : (String(p).split('.')[1] ?? '').length))) + 1;
  const factor = 10 ** Math.min(digits, 6);
  return Math.round(price * factor) / factor;
};

/** The badge in the result column: TP/SL/BE from the exit, otherwise the plain outcome. */
export function rowOutcome(trade: Trade): Outcome {
  if (trade.status === 'open') return 'open';
  return exitReason(trade) ?? (trade.outcome === 'loss' ? 'loss' : 'win');
}

/** Row tint and left edge by outcome: green for wins, red for losses, amber for breakeven. */
const ROW_TONE: Record<Outcome, string> = {
  tp: 'bg-buy-soft/70 shadow-[inset_3px_0_0_var(--buy)]',
  win: 'bg-buy-soft/70 shadow-[inset_3px_0_0_var(--buy)]',
  sl: 'bg-sell-soft/70 shadow-[inset_3px_0_0_var(--sell)]',
  loss: 'bg-sell-soft/70 shadow-[inset_3px_0_0_var(--sell)]',
  be: 'bg-warn-bg/80 shadow-[inset_3px_0_0_var(--warn)]',
  open: 'shadow-[inset_3px_0_0_var(--accent-ink)]',
};

const BADGE: Record<Outcome, string> = {
  tp: 'border-buy/50 text-buy',
  win: 'border-buy/50 text-buy',
  sl: 'border-sell/50 text-sell',
  loss: 'border-sell/50 text-sell',
  be: 'border-warn/60 text-warn',
  open: 'border-accent-ink/60 text-accent-ink',
};

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const t = useT().table;
  const icon =
    outcome === 'tp' || outcome === 'win' ? <path d="m8 12.5 2.5 2.5L16 9.5" /> : outcome === 'sl' || outcome === 'loss' ? <path d="m9.5 9.5 5 5m0-5-5 5" /> : outcome === 'be' ? <path d="M8.5 12h7" /> : <path d="M12 8v4l2.5 1.5" />;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-sans text-[11px] font-bold whitespace-nowrap ${BADGE[outcome]}`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        {icon}
      </svg>
      {t.outcomes[outcome]}
    </span>
  );
}

function DirectionMark({ direction }: { direction: Trade['direction'] }) {
  const t = useT().table;
  return direction === 'long' ? (
    <span className="rounded-md border border-buy/40 bg-buy-soft px-2 py-0.5 font-sans text-[11px] font-bold text-buy uppercase">{t.long}</span>
  ) : (
    <span className="rounded-md border border-sell/40 bg-sell-soft px-2 py-0.5 font-sans text-[11px] font-bold text-sell uppercase">{t.short}</span>
  );
}

const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'text-buy' : 'text-sell');

/** "2 h 15 min", "1 d 6 h" between opening and closing. */
export function tradeDuration(trade: Trade, format: (d: number, h: number, m: number) => string) {
  if (!trade.closedAt) return null;
  const minutes = Math.max(0, Math.round((new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 60_000));
  return format(Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60);
}

function HeaderCell({ children, help, className = '' }: { children: string; help?: string; className?: string }) {
  return (
    <th scope="col" className={`px-3 py-2.5 text-left font-sans text-xs font-semibold whitespace-nowrap text-dim ${className}`}>
      <span className="inline-flex items-center gap-1" title={help}>
        {children}
        {help && (
          <span aria-hidden className="inline-flex size-3.5 items-center justify-center rounded-full border border-dim/50 text-[9px] leading-none">
            ?
          </span>
        )}
      </span>
    </th>
  );
}

export function TradeTable({
  trades,
  accounts = [],
  timezone,
  selectedId,
  onSelect,
  renderDetail,
}: {
  trades: Trade[];
  /** The user's accounts; with any, an account column is shown. */
  accounts?: AccountSummary[];
  timezone: string;
  selectedId: string | null;
  onSelect: (trade: Trade) => void;
  /** Shown in a full-width row under the selected trade (its editor). */
  renderDetail?: (trade: Trade) => ReactNode;
}) {
  const all = useT();
  const labels = all.table;
  if (trades.length === 0) {
    return <p className="m-0 px-5 py-10 text-center text-sm text-dim">{labels.empty}</p>;
  }
  const dateFormat = new Intl.DateTimeFormat(currentLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: timezone });
  const timeFormat = new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit', timeZone: timezone });
  const showAccount = accounts.length > 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] border-collapse font-mono text-sm">
        <thead className="bg-raised">
          <tr>
            <HeaderCell>{labels.actions}</HeaderCell>
            <HeaderCell>{labels.date}</HeaderCell>
            {showAccount && <HeaderCell>{labels.account}</HeaderCell>}
            <HeaderCell>{labels.instrument}</HeaderCell>
            <HeaderCell>{labels.direction}</HeaderCell>
            <HeaderCell>{labels.result}</HeaderCell>
            <HeaderCell help={labels.feesHelp}>{labels.fees}</HeaderCell>
            <HeaderCell help={labels.profitPctHelp}>{labels.profitPct}</HeaderCell>
            <HeaderCell help={labels.riskPctHelp}>{labels.riskPct}</HeaderCell>
            <HeaderCell help={labels.rrHelp}>{labels.rr}</HeaderCell>
            <HeaderCell help={labels.outcomeHelp}>{labels.outcome}</HeaderCell>
            <HeaderCell>{labels.session}</HeaderCell>
            <HeaderCell>{labels.strategy}</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const outcome = rowOutcome(t);
            const opened = new Date(t.openedAt);
            const closed = t.closedAt ? new Date(t.closedAt) : null;
            const sameDay = closed != null && dateFormat.format(closed) === dateFormat.format(opened);
            const account = accounts.find((a) => a.id === t.accountId);
            const selected = t.id === selectedId;
            // Results of the parts ("TP + BE"); a trade counts once everywhere else.
            const exitsLabel = t.parts.map((p) => (p.result === 'manual' ? labels.manualExit : p.result === 'open' ? all.composer.results.open : p.result.toUpperCase())).join(' + ');
            return (
              <Fragment key={t.id}>
              <tr
                onClick={() => onSelect(t)}
                className={`cursor-pointer border-b border-line transition last:border-b-0 hover:brightness-110 ${ROW_TONE[outcome]} ${
                  selected ? 'outline-2 -outline-offset-2 outline-accent-ink' : ''
                }`}
              >
                <td className="px-3 py-3">
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    aria-label={labels.openTradeAria(t.dayLabel)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(t);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-panel px-2.5 py-1.5 font-sans text-[11px] font-semibold text-dim transition hover:text-ink"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                    </svg>
                    {labels.openTrade}
                  </button>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span>
                      <span className="text-dim">{dateFormat.format(opened)}</span> <span className="font-semibold">{timeFormat.format(opened)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 font-sans text-[11px] text-dim">
                      <span title={all.table.dayNumber} className="font-mono">
                        #{t.dayIndex}
                      </span>
                      {closed && <span>· {tradeDuration(t, labels.duration)}</span>}
                      {t.overDailyLimit && <span className="rounded-md bg-accent px-1.5 py-px text-[10px] font-bold text-on-accent">{labels.limitBadge}</span>}
                      {t.source === 'educator' && (
                        <span title={labels.educatorSignal} className="rounded-md bg-chip px-1.5 py-px text-[10px] font-bold">
                          E
                        </span>
                      )}
                      {t.externalId?.startsWith('mt5:') && (
                        <span title={labels.importedMt5} className="rounded-md bg-chip px-1.5 py-px text-[10px] font-bold">
                          MT5
                        </span>
                      )}
                    </span>
                    {closed && (
                      <span>
                        {!sameDay && <span className="text-dim">{dateFormat.format(closed)} </span>}
                        <span className="font-semibold">{timeFormat.format(closed)}</span>
                      </span>
                    )}
                  </div>
                </td>
                {showAccount && <td className="max-w-36 truncate px-3 py-3 font-sans">{account?.name ?? <span className="text-dim">{all.accounts.none}</span>}</td>}
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <InstrumentBadge symbol={t.instrument.symbol} />
                    <span className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-dim">
                      {formatPrice(t.entryPrice)} → {t.exitPrice == null ? '…' : formatPrice(roundLike(t.exitPrice, [t.entryPrice, t.stopLoss, ...t.takeProfits]))}
                      {t.redNews.length > 0 && <RedNewsMark trade={t} />}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <DirectionMark direction={t.direction} />
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span className={`font-semibold ${tone(t.pnlAccount)}`}>
                      {t.pnlAccount != null ? formatAmount(t.pnlAccount, t.accountCurrency) : t.pnlQuote != null ? labels.noRate : '—'}
                    </span>
                    <span className="text-[11px] text-dim">{t.resultUnits == null ? all.common.open : formatUnits(t.resultUnits, all.units.short[t.instrument.measureUnit])}</span>
                  </div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-dim">{t.fees ? formatAmount(t.fees, t.accountCurrency, false) : '—'}</td>
                <td className={`px-3 py-3 whitespace-nowrap ${tone(t.pnlPct)}`}>{t.pnlPct == null ? '—' : `${formatNumber(t.pnlPct, true)}%`}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span>{t.riskPct != null ? `${formatNumber(t.riskPct)}%` : '—'}</span>
                    {t.riskAccount != null && (
                      <span className="text-[11px] text-dim" title={labels.riskTitle(formatAmount(t.riskAccount, t.accountCurrency, false))}>
                        {formatAmount(-t.riskAccount, t.accountCurrency)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span className={`font-semibold ${tone(t.rMultiple)}`}>{t.rMultiple == null ? '—' : `${formatNumber(t.rMultiple, true)} R`}</span>
                    {t.plannedRR != null && <span className="text-[11px] text-dim">{labels.plan(formatNumber(t.plannedRR))}</span>}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    {t.partial ? (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-sans text-[11px] font-bold whitespace-nowrap ${BADGE.open}`}>
                        {labels.partial(formatNumber(t.closedSize), formatNumber(t.positionSize))}
                      </span>
                    ) : (
                      <OutcomeBadge outcome={outcome} />
                    )}
                    {t.parts.length > 1 && <span className="font-sans text-[11px] whitespace-nowrap text-dim">{exitsLabel}</span>}
                  </div>
                </td>
                <td className="px-3 py-3 font-sans text-xs whitespace-nowrap">{all.tradeSessions[t.session] ?? t.session}</td>
                <td className="px-3 py-3 font-sans text-xs">
                  {t.strategy ? (
                    <div className="flex flex-col">
                      <span className="max-w-36 truncate font-semibold">{t.strategy.name}</span>
                      {t.ruleCheck && t.ruleCheck.total > 0 && (
                        <span className={t.ruleCheck.checked === t.ruleCheck.total ? 'text-buy' : 'text-warn'}>{all.composer.rulesKept(t.ruleCheck.checked, t.ruleCheck.total)}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
              </tr>
              {selected && renderDetail && (
                <tr className="border-b border-line bg-panel">
                  <td colSpan={20} className="p-0">
                    <div className="sticky left-0 w-[min(100%,calc(100vw-4rem))] p-5 font-sans">{renderDetail(t)}</div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
