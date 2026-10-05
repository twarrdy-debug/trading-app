import { toLocalDate } from '@trading/shared';
import { useState } from 'react';
import { useMe, useTrades, useTradeStats } from '../../api/hooks.ts';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays } from '../../lib/format.ts';
import { AccountSwitcher, useSelectedAccount } from '../account/AccountSwitcher.tsx';
import { CardLink, DashboardCard, PerformanceBySymbol, ProgressTracker, RecentTrades, Streaks, TRACKER_WEEKS, weekStart } from './DashboardPanels.tsx';
import { DashboardTiles } from './DashboardTiles.tsx';
import { TradeCalendar } from './TradeCalendar.tsx';

const PERIODS = ['all', 'month', 'd30', 'd90', 'year'] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_KEY = 'dashboard-period';

const readPeriod = (): Period => {
  try {
    const stored = localStorage.getItem(PERIOD_KEY);
    return (PERIODS as readonly string[]).includes(stored ?? '') ? (stored as Period) : 'all';
  } catch {
    return 'all';
  }
};

/** First day of the period ending today (undefined = all time). */
const periodStart = (period: Period, today: string) =>
  ({
    all: undefined,
    month: `${today.slice(0, 7)}-01`,
    d30: addDays(today, -29),
    d90: addDays(today, -89),
    year: `${today.slice(0, 4)}-01-01`,
  })[period];

/** Overview of the chosen account and period: key figures, recent trades, progress, calendar and streaks. */
export function DashboardPage() {
  const all = useT();
  const t = all.dashboard;
  const language = useLanguage();
  const { data: me } = useMe();
  const { filter } = useSelectedAccount();
  const [period, setPeriodState] = useState<Period>(readPeriod);
  const setPeriod = (next: Period) => {
    setPeriodState(next);
    try {
      localStorage.setItem(PERIOD_KEY, next);
    } catch {
      // Without storage the period resets on reload.
    }
  };

  const today = me ? toLocalDate(new Date(), me.settings.timezone) : undefined;
  const account = filter || undefined;
  const dateFrom = today ? periodStart(period, today) : undefined;
  const { data: stats } = useTradeStats({ dateFrom, dateTo: dateFrom ? today : undefined, account }, Boolean(today));
  // Weeks start on Monday in Polish and on Sunday in English, as calendars there do.
  const sundayFirst = language === 'en';
  const trackerStart = today ? addDays(weekStart(today, sundayFirst), -(TRACKER_WEEKS - 1) * 7) : undefined;
  const { data: tracker } = useTradeStats({ dateFrom: trackerStart, dateTo: today, account }, Boolean(today));
  const { data: recent } = useTrades({ status: 'closed', limit: 5, account });

  if (!me || !today || !stats) return <main className="grow p-8 text-dim">{all.common.loading}</main>;
  const currency = stats.currency;

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <div className="grow" />
        <AccountSwitcher className="w-56" />
        <div className="w-48">
          <Select aria-label={t.period} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: t.periods[p] }))} />
        </div>
      </div>

      {stats.summary.tradesWithoutPnl > 0 && (
        <p className="m-0 rounded-(--radius-control) bg-warn-bg p-3 text-[13px]">{all.stats.missingPnl(stats.summary.tradesWithoutPnl, currency)}</p>
      )}

      <DashboardTiles stats={stats} />

      <div className="grid gap-4 xl:grid-cols-3">
        <RecentTrades trades={recent?.items ?? []} currency={currency} timezone={me.settings.timezone} />
        <ProgressTracker days={tracker?.equityCurve ?? []} today={today} start={trackerStart!} currency={currency} />
        <DashboardCard title={t.cumulative} info={t.info.cumulative} actions={<CardLink to="/statystyki">{t.reports}</CardLink>}>
          <div className="grow p-4">
            <EquityChart data={stats.equityCurve} currency={currency} height={300} polarity />
          </div>
        </DashboardCard>
      </div>

      <TradeCalendar today={today} account={account} currency={currency} sundayFirst={sundayFirst} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Streaks streaks={stats.streaks} />
        <PerformanceBySymbol rows={stats.byInstrument} currency={currency} />
      </div>
    </main>
  );
}
