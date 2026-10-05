import type { Trade } from '@trading/api/types';
import { toLocalDate } from '@trading/shared';
import { useState, type ReactNode } from 'react';
import { useInstruments, useMe, useTrades, type TradeQuery } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { addDays } from '../../lib/format.ts';
import { AccountSwitcher, useSelectedAccount } from '../account/AccountSwitcher.tsx';
import { Mt5ImportDialog } from '../journal/Mt5ImportDialog.tsx';
import { rowOutcome, TradeFilters, TradeTable } from '../journal/TradeTable.tsx';
import { TradeComposer } from './TradeComposer.tsx';

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

const COMPOSER_KEY = 'trades-composer-open';
const readComposerOpen = () => {
  try {
    return localStorage.getItem(COMPOSER_KEY) !== '0';
  } catch {
    return true;
  }
};

/**
 * Trades: the quick add form on top, then the list. A row opens its editor in place; closing part
 * of a position is ticking the next exit there.
 */
export function TradesPage() {
  const all = useT();
  const t = all.journal;
  const tt = all.trades;
  const { data: me } = useMe();
  const { data: instruments } = useInstruments();
  const [importOpen, setImportOpen] = useState(false);
  const [filters, setFilters] = useState<TradeQuery>({});
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpenState] = useState(readComposerOpen);
  const [composerKey, setComposerKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notice, setNotice] = useState<{ title: string; warnings: string[] } | null>(null);
  const { accounts, filter } = useSelectedAccount();
  const trades = useTrades({ ...filters, account: filter || undefined, limit });

  if (!me || !instruments) return <main className="grow p-8 text-dim">{all.common.loading}</main>;

  const setComposerOpen = (open: boolean) => {
    setComposerOpenState(open);
    try {
      localStorage.setItem(COMPOSER_KEY, open ? '1' : '0');
    } catch {
      // Not remembered without storage.
    }
  };
  const today = toLocalDate(new Date(), me.settings.timezone);
  const items = trades.data?.items ?? [];
  const period = PERIODS.find((p) => {
    const range = periodRange(p, today);
    return range.dateFrom === filters.dateFrom && range.dateTo === filters.dateTo;
  });
  const activeFilters = Object.entries(filters).filter(([key, v]) => v !== undefined && v !== '' && key !== 'dateFrom' && key !== 'dateTo').length;
  const newTrade = () => {
    setComposerOpen(true);
    setComposerKey((k) => k + 1);
    requestAnimationFrame(() => document.getElementById('trade-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{tt.title}</h1>
        <div className="grow" />
        <AccountSwitcher className="w-56" />
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
            options={[...PERIODS.map((p) => ({ value: p, label: all.dashboard.periods[p] })), ...(period ? [] : [{ value: 'custom', label: all.table.customRange }])]}
          />
        </div>
        <Button size="md" variant="primary" onClick={newTrade}>
          + {all.table.newTrade}
        </Button>
      </div>

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

      <section id="trade-composer" className="card scroll-mt-28">
        <header className="flex items-center gap-3 px-5 py-3.5">
          <h2 className="m-0 text-[15px] font-bold">{all.composer.title}</h2>
          <span className="text-xs text-dim">{tt.composerHint}</span>
          <div className="grow" />
          <Button size="sm" variant="ghost" aria-expanded={composerOpen} onClick={() => setComposerOpen(!composerOpen)}>
            {composerOpen ? tt.collapse : tt.expand}
          </Button>
        </header>
        {composerOpen && (
          <div className="border-t border-line p-5">
            <TradeComposer
              key={`new-${composerKey}-${filter}`}
              user={me}
              instruments={instruments}
              accounts={accounts}
              preferredAccountId={filter && filter !== 'none' ? filter : undefined}
              onSaved={(result) => {
                setNotice({ title: t.added(result.trade.dayLabel), warnings: result.warnings });
                setComposerKey((k) => k + 1);
              }}
            />
          </div>
        )}
      </section>

      <Panel
        title={t.trades}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2 py-2">
            <span className="font-mono text-xs text-dim">{trades.data ? t.countOf(items.length, trades.data.total) : ''}</span>
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
          onSelect={(trade) => setSelectedId((id) => (id === trade.id ? null : trade.id))}
          renderDetail={(trade) => (
            <TradeComposer
              key={trade.id + trade.updatedAt}
              user={me}
              instruments={instruments}
              accounts={accounts}
              trade={trade}
              onSaved={(result) => {
                setNotice({ title: t.saved(result.trade.dayLabel), warnings: result.warnings });
                setSelectedId(null);
              }}
              onCancel={() => setSelectedId(null)}
              onDeleted={() => {
                setNotice({ title: t.deleted, warnings: [] });
                setSelectedId(null);
              }}
            />
          )}
        />
        {trades.data && items.length < trades.data.total && (
          <div className="flex justify-center p-4">
            <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              {t.showMore}
            </Button>
          </div>
        )}
      </Panel>
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
    </main>
  );
}
