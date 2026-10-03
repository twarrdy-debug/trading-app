import type { PublicUser, TradeMutation } from '@trading/api/types';
import { toLocalDate } from '@trading/shared';
import { useState } from 'react';
import { useInstruments, useMe, useTrades, useTradeStats, type TradeQuery } from '../../api/hooks.ts';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Gauge, Stat } from '../../components/ui/Stat.tsx';
import { useT } from '../../i18n/index.tsx';
import { currencyLabel, formatAmount, formatNumber, formatPercent } from '../../lib/format.ts';
import { AccountSwitcher, useSelectedAccount } from '../account/AccountSwitcher.tsx';
import { AccountPanel, accountLevels } from '../account/AccountViews.tsx';
import { MonitorPanel } from './MonitorPanel.tsx';
import { Mt5ImportDialog } from './Mt5ImportDialog.tsx';
import { TradeForm } from './TradeForm.tsx';
import { TradeFilters, TradeTable } from './TradeTable.tsx';

const PAGE = 50;

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
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-dim">{trades.data ? t.countOf(items.length, trades.data.total) : ''}</span>
              <Button size="sm" onClick={() => setImportOpen(true)}>
                {t.importMt5}
              </Button>
            </div>
          }
        >
          <TradeFilters
            value={filters}
            onChange={(next) => {
              setFilters(next);
              setLimit(PAGE);
            }}
            instruments={instruments}
          />
          <TradeTable
            trades={items}
            accounts={filter === '' ? accounts : []}
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
