import type { TradeStats } from '@trading/api/types';
import { toLocalDate } from '@trading/shared';
import { useState } from 'react';
import { useInstruments, useMe, useTradeStats } from '../../api/hooks.ts';
import { BarList, type BarRow } from '../../components/charts/BarList.tsx';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Segmented } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { AccountSwitcher, useSelectedAccount } from '../account/AccountSwitcher.tsx';
import { AccountCards, AccountTiles, accountLevels } from '../account/AccountViews.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { Gauge, Stat } from '../../components/ui/Stat.tsx';
import { useT, type Messages } from '../../i18n/index.tsx';
import { addDays, currencyLabel, formatAmount, formatNumber, formatPercent } from '../../lib/format.ts';
import { instrumentOptions } from '../../lib/instruments.ts';

type Range = '7' | '30' | '90' | 'all';

type Breakdown = TradeStats['byInstrument'][number];

type StatsText = Messages['stats'];

const pnlRows = (t: StatsText, list: Breakdown[], currency: string): BarRow[] =>
  [...list]
    .sort((a, b) => b.pnl - a.pnl)
    .map((b) => ({
      key: b.key,
      label: b.key,
      value: b.pnl,
      display: formatAmount(b.pnl, currency),
      detail: t.detail(b.trades, formatPercent(b.winRate), formatNumber(b.avgR, true)),
    }));

const winRateRows = (
  t: StatsText,
  list: (Breakdown & { label?: string })[],
  label: (b: Breakdown & { label?: string }) => string,
  currency: string,
): BarRow[] =>
  list.map((b) => ({
    key: b.key,
    label: label(b),
    value: b.winRate,
    display: formatPercent(b.winRate),
    detail: t.winRateDetail(b.trades, formatNumber(b.avgR, true), formatAmount(b.pnl, currency)),
  }));

export function StatsPage() {
  const all = useT();
  const t = all.stats;
  const { data: me } = useMe();
  const { data: instruments } = useInstruments();
  const [range, setRange] = useState<Range>('30');
  const [instrumentId, setInstrumentId] = useState('');

  const today = me ? toLocalDate(new Date(), me.settings.timezone) : undefined;
  const dateFrom = today && range !== 'all' ? addDays(today, -(Number(range) - 1)) : undefined;
  const { filter } = useSelectedAccount();
  const { data: stats } = useTradeStats({
    dateFrom,
    dateTo: range === 'all' ? undefined : today,
    instrumentId: instrumentId || undefined,
    account: filter || undefined,
  });

  if (!me || !stats) return <main className="grow p-8 text-dim">{all.common.loading}</main>;

  const s = stats.summary;
  const currency = stats.currency;

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <div className="grow" />
        <AccountSwitcher className="w-56" />
        <div className="w-56">
          <Select
            aria-label={all.table.instrument}
            value={instrumentId}
            onChange={setInstrumentId}
            options={[{ value: '', label: t.allInstruments }, ...instrumentOptions(instruments ?? [], { label: (i) => i.symbol, favorites: all.instruments.favorites, others: all.instruments.others })]}
          />
        </div>
        <Segmented
          label={t.range}
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: '7D' },
            { value: '30', label: '30D' },
            { value: '90', label: '90D' },
            { value: 'all', label: t.whole },
          ]}
        />
      </div>

      {s.tradesWithoutPnl > 0 && (
        <p className="m-0 rounded-(--radius-control) bg-warn-bg p-3 text-[13px]">
          {t.missingPnl(s.tradesWithoutPnl, currency)}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={all.journal.winRate} value={formatPercent(s.winRate)} visual={<Gauge percent={s.winRate} />} foot={t.winsLossesTotal(s.wins, s.losses, s.trades)} />
        <Stat
          label={t.result}
          value={formatAmount(s.pnl, currency)}
          tone={s.pnl < 0 ? 'sell' : s.pnl > 0 ? 'buy' : 'ink'}
          foot={[currencyLabel(currency), s.returnPct != null ? `${formatNumber(s.returnPct, true)}%` : ''].filter(Boolean).join(' · ') || undefined}
        />
        <Stat label={all.journal.avgR} value={s.avgR == null ? '—' : `${formatNumber(s.avgR, true)} R`} foot={all.journal.planRR(formatNumber(s.avgPlannedRR))} />
        <Stat label={all.journal.profitFactor} value={formatNumber(s.profitFactor)} foot={all.journal.maxLossStreak(s.maxLossStreak)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t.avgWin} value={formatAmount(s.avgWin, currency)} tone="buy" foot={currencyLabel(currency) || undefined} />
        <Stat label={t.avgLoss} value={formatAmount(s.avgLoss, currency)} tone="sell" foot={currencyLabel(currency) || undefined} />
        <Stat label={t.trades} value={String(s.trades)} foot={t.closedInPeriod} />
        <Stat
          label={all.account.periodMaxDrawdown}
          value={s.maxDrawdown > 0 ? formatAmount(-s.maxDrawdown, currency) : formatAmount(0, currency, false)}
          tone={s.maxDrawdown > 0 ? 'sell' : 'ink'}
          foot={[currencyLabel(currency), s.maxDrawdownPct != null ? all.account.ofAccount(`${formatNumber(s.maxDrawdownPct)}%`) : ''].filter(Boolean).join(' · ') || undefined}
        />
      </div>

      {stats.account ? (
        <AccountTiles account={stats.account} currency={currency} />
      ) : (
        filter === '' && stats.accounts.length > 0 && <AccountCards accounts={stats.accounts} currency={currency} />
      )}

      <Panel title={all.journal.equityCurve} actions={currencyLabel(currency) ? <span className="font-mono text-xs text-dim">{currencyLabel(currency)}</span> : undefined}>
        <div className="px-3 py-4">
          <EquityChart
            data={stats.equityCurve}
            currency={currency}
            height={280}
            balance={stats.balanceCurve}
            levels={stats.balanceCurve ? accountLevels(all, stats.account) : []}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title={t.byInstrument(currencyLabel(currency))}>
          <BarList polarity rows={pnlRows(t, stats.byInstrument, currency)} />
        </Panel>
        <Panel title={t.bySource(currencyLabel(currency))}>
          <BarList polarity rows={pnlRows(t, stats.bySource, currency)} />
        </Panel>
        <Panel title={t.byDayIndex}>
          <BarList max={100} rows={winRateRows(t, stats.byDayIndex, (b) => t.nthTrade(b.key), currency)} />
        </Panel>
        <Panel title={t.byEmotion}>
          <BarList max={100} rows={winRateRows(t, [...stats.byEmotion].sort((a, b) => b.trades - a.trades), (b) => b.label ?? b.key, currency)} />
        </Panel>
      </div>
    </main>
  );
}
