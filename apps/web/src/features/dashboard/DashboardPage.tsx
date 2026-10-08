import { DASHBOARD_WIDGETS, toLocalDate, type DashboardWidget } from '@trading/shared';
import { useState } from 'react';
import { useMe, useTrades, useTradeStats } from '../../api/hooks.ts';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays } from '../../lib/format.ts';
import { LockedPreview } from '../../components/ui/LockedPreview.tsx';
import { AccountsAndMonitor } from '../account/AccountsAndMonitor.tsx';
import { AccountSwitcher, useSelectedAccount } from '../account/AccountSwitcher.tsx';
import { DashboardCustomize } from './DashboardCustomize.tsx';
import { DashboardPreview } from './DashboardPreview.tsx';
import { CardLink, DashboardCard, PerformanceBySymbol, ProgressTracker, RecentTrades, Streaks, TRACKER_WEEKS, weekStart } from './DashboardPanels.tsx';
import { DashboardTiles, type MonthFigures } from './DashboardTiles.tsx';
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
  // This month, whatever the period: the month tile.
  const monthStart = today ? `${today.slice(0, 7)}-01` : undefined;
  const { data: monthStats } = useTradeStats({ dateFrom: monthStart, dateTo: today, account }, Boolean(today));
  // Any trade at all (open ones included, any account): without one the dashboard is a locked preview.
  const { data: anyTrade } = useTrades({ limit: 1 });

  if (!me || !today || !stats || !anyTrade) return <main className="page text-dim">{all.common.loading}</main>;
  const currency = stats.currency;
  const hidden = new Set<DashboardWidget>(me.settings.dashboardHidden);
  const show = (w: DashboardWidget) => !hidden.has(w);
  const month: MonthFigures | undefined = monthStats && {
    label: all.months[Number(today.slice(5, 7)) - 1]!,
    pnl: monthStats.summary.pnl,
    trades: monthStats.summary.trades,
    returnPct: monthStats.summary.returnPct,
    curve: monthStats.equityCurve.map((p) => p.cumulative),
  };

  if (anyTrade.items.length === 0) {
    return (
      <main className="page">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <LockedPreview title={all.locked.dashboardTitle} text={all.locked.text}>
          <DashboardPreview />
        </LockedPreview>
      </main>
    );
  }
  const middle = (['recentTrades', 'progress', 'cumulative'] as const).filter(show);
  const bottom = (['streaks', 'bySymbol'] as const).filter(show);

  return (
    <main className="page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <div className="grow" />
        <AccountSwitcher className="w-56" />
        <div className="w-48">
          <Select aria-label={t.period} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: t.periods[p] }))} />
        </div>
        <DashboardCustomize hidden={me.settings.dashboardHidden} />
      </div>

      {stats.summary.tradesWithoutPnl > 0 && (
        <p className="m-0 rounded-(--radius-control) bg-warn-bg p-3 text-[13px]">{all.stats.missingPnl(stats.summary.tradesWithoutPnl, currency)}</p>
      )}

      <DashboardTiles stats={stats} month={month} hidden={hidden} />

      <AccountsAndMonitor currency={me.settings.accountCurrency} accounts={show('accounts')} monitor={show('monitor')} />

      {middle.length > 0 && (
        <div className={`grid gap-4 ${middle.length === 3 ? 'xl:grid-cols-3' : middle.length === 2 ? 'lg:grid-cols-2' : ''}`}>
          {show('recentTrades') && <RecentTrades trades={recent?.items ?? []} currency={currency} timezone={me.settings.timezone} />}
          {show('progress') && <ProgressTracker days={tracker?.equityCurve ?? []} today={today} start={trackerStart!} currency={currency} />}
          {show('cumulative') && (
            <DashboardCard title={t.cumulative} info={t.info.cumulative} actions={<CardLink to="/statystyki">{t.reports}</CardLink>}>
              <div className="grow p-4">
                <EquityChart data={stats.equityCurve} currency={currency} height={300} polarity />
              </div>
            </DashboardCard>
          )}
        </div>
      )}

      {show('calendar') && <TradeCalendar today={today} account={account} currency={currency} sundayFirst={sundayFirst} />}

      {bottom.length > 0 && (
        <div className={`grid gap-4 ${bottom.length === 2 ? 'xl:grid-cols-2' : ''}`}>
          {show('streaks') && <Streaks streaks={stats.streaks} />}
          {show('bySymbol') && <PerformanceBySymbol rows={stats.byInstrument} currency={currency} />}
        </div>
      )}

      {hidden.size === DASHBOARD_WIDGETS.length && <p className="m-0 py-10 text-center text-sm text-dim">{t.allHidden}</p>}
    </main>
  );
}
