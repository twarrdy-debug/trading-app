import type { AccountSummary, Instrument, Trade } from '@trading/api/types';
import { DIRECTIONS } from '@trading/shared';
import type { TradeQuery } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale, formatAmount, formatNumber, formatPrice, formatUnits } from '../../lib/format.ts';
import { instrumentOptions } from '../../lib/instruments.ts';

const COLUMNS = 'grid grid-cols-[156px_104px_80px_minmax(128px,1fr)_60px_90px_90px_100px] gap-3 px-5';

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
        <Input type="date" value={value.dateFrom ?? ''} onChange={(e) => set({ dateFrom: e.target.value || undefined })} />
      </Field>
      <Field label={t.dateTo}>
        <Input type="date" value={value.dateTo ?? ''} onChange={(e) => set({ dateTo: e.target.value || undefined })} />
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

function DirectionMark({ direction }: { direction: Trade['direction'] }) {
  const t = useT().table;
  return direction === 'long' ? (
    <span className="justify-self-start rounded-md bg-buy-soft px-2 py-1 font-sans text-[11px] font-bold text-buy">{t.long}</span>
  ) : (
    <span className="justify-self-start rounded-md bg-sell-soft px-2 py-1 font-sans text-[11px] font-bold text-sell">{t.short}</span>
  );
}

export function TradeTable({
  trades,
  accounts = [],
  selectedId,
  onSelect,
}: {
  trades: Trade[];
  /** When given (the "all accounts" view), each row shows its account name. */
  accounts?: AccountSummary[];
  selectedId: string | null;
  onSelect: (trade: Trade) => void;
}) {
  const all = useT();
  const labels = all.table;
  if (trades.length === 0) {
    return <p className="m-0 px-5 py-10 text-center text-sm text-dim">{labels.empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[940px]">
        <div className={`${COLUMNS} eyebrow bg-raised py-2.5 text-[11px]`} aria-hidden>
          <span>{labels.dayNumber}</span>
          <span>{labels.instrument}</span>
          <span>{labels.direction}</span>
          <span>{labels.entryExit}</span>
          <span>{labels.risk}</span>
          <span title={labels.slTitle}>{labels.slMoney}</span>
          <span>{labels.result}</span>
          <span className="text-right">{labels.accountCurrency}</span>
        </div>
        <ul className="m-0 list-none p-0">
          {trades.map((t) => {
            const tone = t.pnlAccount == null && t.resultUnits == null ? 'text-dim' : (t.resultUnits ?? 0) >= 0 ? 'text-buy' : 'text-sell';
            return (
              <li key={t.id} className="border-b border-grid last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(t)}
                  aria-current={t.id === selectedId}
                  className={`${COLUMNS} w-full items-center py-3.5 text-left font-mono text-sm text-ink transition hover:bg-raised ${
                    t.id === selectedId ? 'bg-raised' : t.overDailyLimit ? 'bg-warn-bg' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {t.dayLabel.split(' – ')[0]}
                    {t.overDailyLimit && (
                      <span className="rounded-md bg-accent px-1.5 py-0.5 font-sans text-[10px] font-bold text-on-accent">{labels.limitBadge}</span>
                    )}
                    {t.source === 'educator' && (
                      <span title={labels.educatorSignal} className="rounded-md bg-chip px-1.5 py-0.5 font-sans text-[10px] font-bold text-dim">
                        E
                      </span>
                    )}
                    {t.externalId?.startsWith('mt5:') && (
                      <span title={all.table.importedMt5} className="rounded-md bg-chip px-1.5 py-0.5 font-sans text-[10px] font-bold text-dim">
                        MT5
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col font-sans">
                    <span className="font-bold">{t.instrument.symbol}</span>
                    {accounts.length > 0 && (
                      <span className="truncate text-[11px] text-dim">{accounts.find((a) => a.id === t.accountId)?.name ?? all.accounts.none}</span>
                    )}
                  </span>
                  <DirectionMark direction={t.direction} />
                  <span className="flex min-w-0 items-center gap-2 text-dim">
                    <span className="truncate">
                      {formatPrice(t.entryPrice)} → {t.exitPrice == null ? all.common.open : formatPrice(t.exitPrice)}
                    </span>
                    {t.redNews.length > 0 && <RedNewsMark trade={t} />}
                  </span>
                  <span className="text-dim">{t.riskPct != null ? `${formatNumber(t.riskPct)}%` : '—'}</span>
                  <span
                    className="truncate text-dim"
                    title={t.riskAccount != null ? labels.riskTitle(formatAmount(t.riskAccount, t.accountCurrency, false)) : undefined}
                  >
                    {t.riskAccount != null ? formatAmount(-t.riskAccount, t.accountCurrency) : '—'}
                  </span>
                  <span className={tone}>{formatUnits(t.resultUnits, all.units.short[t.instrument.measureUnit])}</span>
                  <span className={`text-right ${tone}`}>
                    {t.pnlAccount != null ? formatAmount(t.pnlAccount, t.accountCurrency) : t.pnlQuote != null ? all.table.noRate : '—'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
