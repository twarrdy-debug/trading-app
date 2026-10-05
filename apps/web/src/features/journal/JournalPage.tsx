import type { PublicUser, TradeMutation } from '@trading/api/types';
import { toLocalDate } from '@trading/shared';
import { useState, type ReactNode } from 'react';
import { useInstruments, useMe, useTrades, useTradeStats, type TradeQuery } from '../../api/hooks.ts';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { Gauge, Stat } from '../../components/ui/Stat.tsx';
import { useT } from '../../i18n/index.tsx';
import { addDays, currencyLabel, formatAmount, formatNumber, formatPercent } from '../../lib/format.ts';
import { AccountSwitcher, useSelectedAccount } from '../account/AccountSwitcher.tsx';
import { AccountPanel, accountLevels } from '../account/AccountViews.tsx';
import { MonitorPanel } from './MonitorPanel.tsx';
import { Mt5ImportDialog } from './Mt5ImportDialog.tsx';
import { TradeForm } from './TradeForm.tsx';
import { rowOutcome, TradeFilters, TradeTable } from './TradeTable.tsx';
import type { Trade } from '@trading/api/types';

const PAGE = 50;

const PERIODS = ['all', 'month', 'd30', 'd90', 'year'] as const;
type Period = (typeof PERIODS)[number];

/** Date range of a period ending today (all time = no range). */
const periodRange = (period: Period, today: string) =>
  ({
    all: {},
    month: { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today },
    d30: { dateFrom: addDays(today, -29), dateTo: today },
    d90: { dateFrom: addDays(today, -89), dateTo: today },
    year: { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today },
  })[period] as { dateFrom?: string; dateTo?: string };

/** The loaded trades as a CSV file (semicolons, so spreadsheets in Polish locales open it). */
function downloadCsv(trades: Trade[], accountName: (id: string | null) => string) {
  const header = ['day_label', 'opened_at', 'closed_at', 'account', 'symbol', 'direction', 'entry', 'exit', 'stop_loss', 'take_profit', 'size', 'result_units', 'pnl', 'currency', 'fees', 'pnl_pct', 'risk_pct', 'r', 'outcome'];
  const cell = (v: unknown) => {
    const text = v == null ? '' : String(v);
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = trades.map((t) =>
    [t.dayLabel, t.openedAt, t.closedAt, accountName(t.accountId), t.instrument.symbol, t.direction, t.entryPrice, t.exitPrice, t.stopLoss, t.takeProfit, t.positionSize, t.resultUnits, t.pnlAccount, t.accountCurrency, t.fees, t.pnlPct, t.riskPct, t.rMultiple, rowOutcome(t)]
      .map(cell)
      .join(';'),
  );
  const blob = new Blob([[header.join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transakcje-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-[10px] border border-line text-dim transition hover:bg-chip hover:text-ink"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function MonthOverview({ user, today }: { user: PublicUser; today: string }) {
  const all = useT();
  const t = all.journal;
  const monthStart = `${today.slice(0, 8)}01`;
  const { filter } = useSelectedAccount();
  const { data: stats } = useTradeStats({ dateFrom: monthStart, dateTo: today, account: filter || undefined });
  const s = stats?.summary;
  // Today in the user's time zone, for the same account selection.
  const { data: todayStats } = useTradeStats({ dateFrom: today, dateTo: today, account: filter || undefined });
  const d = todayStats?.summary;
  const currency = user.settings.accountCurrency;
  const month = all.months[Number(today.slice(5, 7)) - 1]!;

  return (
    <>
      {/* Five in a row from 1400 px (87.5rem, in rem so it sorts after sm:); below that pairs, so today and the month share a row. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[87.5rem]:grid-cols-5">
        <Stat label={t.winRate} value={formatPercent(s?.winRate)} visual={<Gauge percent={s?.winRate ?? null} />} foot={s ? t.winsLosses(s.wins, s.losses) : undefined} />
        <Stat label={t.avgR} value={s?.avgR == null ? '—' : `${formatNumber(s.avgR, true)} R`} foot={s?.avgPlannedRR != null ? t.planRR(formatNumber(s.avgPlannedRR)) : undefined} />
        <Stat
          label={t.resultToday}
          value={formatAmount(d?.pnl, currency)}
          tone={d && d.pnl < 0 ? 'sell' : d && d.pnl > 0 ? 'buy' : 'ink'}
          foot={d ? `${t.currencyTrades(currencyLabel(currency), d.trades)}${d.returnPct != null ? ` · ${formatNumber(d.returnPct, true)}%` : ''}` : undefined}
        />
        <Stat
          label={t.resultIn(month)}
          value={formatAmount(s?.pnl, currency)}
          tone={s && s.pnl < 0 ? 'sell' : s && s.pnl > 0 ? 'buy' : 'ink'}
          foot={s ? `${t.currencyTrades(currencyLabel(currency), s.trades)}${s.returnPct != null ? ` · ${formatNumber(s.returnPct, true)}%` : ''}` : undefined}
        />
        <Stat label={t.profitFactor} value={formatNumber(s?.profitFactor)} foot={s ? t.maxLossStreak(s.maxLossStreak) : undefined} />
      </div>
      <Panel title={t.equityCurve} actions={<span className="font-mono text-xs text-dim">{month}</span>}>
        <div className="px-3 py-4">
          <EquityChart
            data={stats?.equityCurve ?? []}
            currency={currency}
            height={220}
            balance={stats?.balanceCurve}
            levels={stats?.balanceCurve ? accountLevels(all, stats.account) : []}
          />
        </div>
      </Panel>
    </>
  );
}

/** The selected account's panel, or one per account in the "all accounts" view. */
function JournalAccounts({ currency }: { currency: string }) {
  const { accounts, filter, selected } = useSelectedAccount();
  const shown = selected ? [selected] : filter === '' ? accounts : [];
  return (
    <>
      {shown.map((a) => (
        <AccountPanel key={a.id} account={a} currency={currency} />
      ))}
    </>
  );
}

export function JournalPage() {
  const all = useT();
  const t = all.journal;
  const { data: me } = useMe();
  const [importOpen, setImportOpen] = useState(false);
  const { data: instruments } = useInstruments();
  const [filters, setFilters] = useState<TradeQuery>({});
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [notice, setNotice] = useState<{ title: string; warnings: string[] } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { accounts, filter } = useSelectedAccount();
  const trades = useTrades({ ...filters, account: filter || undefined, limit });

  if (!me || !instruments) {
    return <main className="grow p-8 text-dim">{all.common.loading}</main>;
  }

  const today = toLocalDate(new Date(), me.settings.timezone);
  const items = trades.data?.items ?? [];
  const selected = items.find((t) => t.id === selectedId);

  const closeForm = () => {
    setSelectedId(null);
    setFormKey((k) => k + 1);
  };
  // "+ New": an empty form, scrolled into view (below the list on narrow screens).
  const newTrade = () => {
    closeForm();
    requestAnimationFrame(() => {
      const form = document.getElementById('trade-form');
      form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
    });
  };
  const period = PERIODS.find((p) => {
    const range = periodRange(p, today);
    return range.dateFrom === filters.dateFrom && range.dateTo === filters.dateTo;
  });
  const activeFilters = Object.entries(filters).filter(([key, v]) => v !== undefined && v !== '' && key !== 'dateFrom' && key !== 'dateTo').length;
  const onSaved = (result: TradeMutation, mode: 'created' | 'updated') => {
    setNotice({ title: mode === 'created' ? t.added(result.trade.dayLabel) : t.saved(result.trade.dayLabel), warnings: result.warnings });
    closeForm();
  };

  return (
    <div className="flex grow flex-col gap-6 p-4 md:px-8 md:py-6 xl:flex-row">
      <main className="flex min-w-0 grow flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="m-0 text-2xl font-bold tracking-tight">{all.nav.journal}</h1>
          <div className="grow" />
          <AccountSwitcher className="w-64" />
        </div>
        <MonthOverview user={me} today={today} />

        <Panel
          title={t.trades}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2 py-2">
              <span className="font-mono text-xs text-dim">{trades.data ? t.countOf(items.length, trades.data.total) : ''}</span>
              <div className="w-44">
                <Select
                  aria-label={all.table.period}
                  value={period ?? 'custom'}
                  onChange={(p) => {
                    if (p === 'custom') return;
                    const { dateFrom, dateTo } = periodRange(p as Period, today);
                    setFilters({ ...filters, dateFrom, dateTo });
                    setLimit(PAGE);
                  }}
                  options={[
                    ...PERIODS.map((p) => ({ value: p, label: all.dashboard.periods[p] })),
                    ...(period ? [] : [{ value: 'custom', label: all.table.customRange }]),
                  ]}
                />
              </div>
              <Button size="sm" selected={filtersOpen || activeFilters > 0 ? undefined : false} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                  <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
                  <circle cx="16" cy="6" r="2" />
                  <circle cx="10" cy="12" r="2" />
                  <circle cx="18" cy="18" r="2" />
                </svg>
                {all.table.filters}
                {activeFilters > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent">{activeFilters}</span>}
              </Button>
              <Button size="sm" onClick={() => setImportOpen(true)} title={t.importMt5Help}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
                </svg>
                {t.importMt5}
              </Button>
              <IconButton label={all.table.exportCsv} onClick={() => downloadCsv(items, (id) => accounts.find((a) => a.id === id)?.name ?? '')}>
                <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" />
                <path d="M14 3v5h5M12 11v6m0 0-2.5-2.5M12 17l2.5-2.5" />
              </IconButton>
              <Button size="sm" variant="primary" onClick={newTrade}>
                + {all.table.newTrade}
              </Button>
            </div>
          }
        >
          {(filtersOpen || activeFilters > 0) && (
            <TradeFilters
              value={filters}
              onChange={(next) => {
                setFilters(next);
                setLimit(PAGE);
              }}
              instruments={instruments}
            />
          )}
          <TradeTable
            trades={items}
            accounts={accounts}
            timezone={me.settings.timezone}
            selectedId={selectedId}
            onSelect={(t) => setSelectedId(t.id)}
          />
          {trades.data && items.length < trades.data.total && (
            <div className="flex justify-center p-4">
              <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                {t.showMore}
              </Button>
            </div>
          )}
        </Panel>
      </main>

      <aside className="flex w-full shrink-0 flex-col gap-5 xl:w-[380px]">
        <JournalAccounts currency={me.settings.accountCurrency} />
        <MonitorPanel />
        {notice && (
          <div role="status" className="card flex flex-col gap-1.5 p-4 text-[13px] ring-1 ring-accent">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{notice.title}</span>
              <button type="button" aria-label={all.common.closeNotice} onClick={() => setNotice(null)} className="size-7 rounded-lg text-dim hover:bg-chip hover:text-ink">
                ✕
              </button>
            </div>
            {notice.warnings.map((w) => (
              <span key={w} className="text-dim">
                {w}
              </span>
            ))}
          </div>
        )}
        <div id="trade-form" className="scroll-mt-28">
          <TradeForm
            key={selected ? selected.id : `new-${formKey}-${filter}`}
            user={me}
            instruments={instruments}
            defaultInstrumentId={items[0]?.instrumentId}
            accounts={accounts}
            defaultAccountId={filter && filter !== 'none' ? filter : accounts.length === 1 ? accounts[0]!.id : ''}
            trade={selected}
            onSaved={onSaved}
            onDeleted={() => {
              setNotice({ title: t.deleted, warnings: [] });
              closeForm();
            }}
            onCancel={closeForm}
          />
        </div>
      </aside>
      {importOpen && (
        <Mt5ImportDialog
          instruments={instruments}
          accounts={accounts}
          defaultAccountId={filter && filter !== 'none' ? filter : ''}
          timezone={me.settings.timezone}
          onClose={() => setImportOpen(false)}
          onImported={(n) => setNotice({ title: all.mt5.done(n), warnings: [] })}
        />
      )}
    </div>
  );
}
