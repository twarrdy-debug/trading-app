import { useState } from 'react';
import { useTradeStats } from '../../api/hooks.ts';
import { useT } from '../../i18n/index.tsx';
import { addDays, currentLocale, formatAmount } from '../../lib/format.ts';
import { DashboardCard, weekStart } from './DashboardPanels.tsx';

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by, 1);
  return d.toISOString().slice(0, 10);
};

/** Month of daily results with a weekly summary column; independent of the dashboard period. */
export function TradeCalendar({ today, account, currency, sundayFirst }: { today: string; account?: string; currency: string; sundayFirst: boolean }) {
  const all = useT();
  const t = all.dashboard;
  const [month, setMonth] = useState(() => monthStart(today));
  const monthEnd = addDays(shiftMonth(month, 1), -1);
  const { data: stats } = useTradeStats({ dateFrom: month, dateTo: monthEnd, account });
  const byDate = new Map((stats?.equityCurve ?? []).map((d) => [d.date, d]));

  const first = weekStart(month, sundayFirst);
  const weeks: string[][] = [];
  for (let start = first; start <= monthEnd; start = addDays(start, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  const weekdayName = new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: 'UTC' });
  const title = new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T12:00:00Z`));
  const monthTotal = (stats?.equityCurve ?? []).reduce((sum, d) => sum + d.pnl, 0);
  const tone = (v: number) => (v > 0 ? 'text-buy' : v < 0 ? 'text-sell' : 'text-dim');

  return (
    <DashboardCard
      title={t.calendar}
      info={t.info.calendar}
      actions={
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t.prevMonth} title={t.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))} className="flex size-8 items-center justify-center rounded-[9px] text-dim hover:bg-chip hover:text-ink">
            ‹
          </button>
          <span className="min-w-36 text-center text-sm font-semibold capitalize">{title}</span>
          <button type="button" aria-label={t.nextMonth} title={t.nextMonth} onClick={() => setMonth(shiftMonth(month, 1))} className="flex size-8 items-center justify-center rounded-[9px] text-dim hover:bg-chip hover:text-ink">
            ›
          </button>
          <span className={`ml-2 font-mono text-sm font-semibold ${tone(monthTotal)}`}>{formatAmount(monthTotal, currency)}</span>
        </div>
      }
    >
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_170px]">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {weeks[0]!.map((d) => (
            <span key={d} className="pb-1 text-center text-xs font-semibold text-dim capitalize">
              {weekdayName.format(new Date(`${d}T12:00:00Z`))}
            </span>
          ))}
          {weeks.flat().map((date) => {
            const inMonth = date.slice(0, 7) === month.slice(0, 7);
            const day = byDate.get(date);
            const bg = !inMonth ? 'border-transparent bg-transparent' : day ? (day.pnl > 0 ? 'border-buy/30 bg-buy-soft' : day.pnl < 0 ? 'border-sell/30 bg-sell-soft' : 'border-line bg-raised') : 'border-line bg-raised';
            return (
              <div
                key={date}
                aria-hidden={!inMonth || undefined}
                className={`flex min-h-16 flex-col justify-between rounded-[10px] border p-1.5 sm:min-h-24 sm:p-2.5 ${bg} ${date === today ? 'ring-2 ring-ink' : ''}`}
              >
                {inMonth && (
                  <>
                    <span className="text-xs font-semibold sm:text-sm">{Number(date.slice(8))}</span>
                    {day ? (
                      <span className="flex flex-col">
                        <span className={`font-mono text-[10px] font-semibold tabular-nums sm:text-sm ${tone(day.pnl)}`}>{formatAmount(day.pnl, currency)}</span>
                        <span className="hidden text-[11px] text-dim sm:block">{all.common.trades(day.trades)}</span>
                      </span>
                    ) : (
                      <span className="hidden text-xs text-dim sm:block">{date <= today ? t.noTradesDay : ''}</span>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:mt-7 lg:flex lg:flex-col">
          {weeks.map((week, i) => {
            const days = week.filter((d) => d.slice(0, 7) === month.slice(0, 7)).map((d) => byDate.get(d)).filter((d) => d != null);
            const pnl = days.reduce((sum, d) => sum + d.pnl, 0);
            return (
              <li key={week[0]} className="flex flex-col items-center justify-center gap-0.5 rounded-[10px] border border-line bg-raised px-3 py-2.5 lg:min-h-24">
                <span className="text-xs text-dim">{t.week(i + 1)}</span>
                <span className={`font-mono text-base font-bold tabular-nums ${tone(pnl)}`}>{formatAmount(pnl, currency)}</span>
                <span className="text-[11px] text-dim">{t.activeDays(days.length)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </DashboardCard>
  );
}
