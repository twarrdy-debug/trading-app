import type { CalendarEvent } from '@trading/api/types';
import { EVENT_IMPACTS } from '@trading/shared';
import { CurrencyFlag } from '../../components/ui/InstrumentBadge.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays } from '../../lib/format.ts';
import { formatTime, ImpactPill, isRelease, markets, minutesUntil, surpriseOf, weekdayName } from './parts.tsx';

const TILE = 'card flex min-w-0 flex-col gap-1 px-5 py-4';
const VALUE = 'text-[26px] leading-tight font-bold tracking-tight tabular-nums';

/**
 * The four tiles above the calendar, always about today and this week whatever date is shown:
 * the next high-impact event with a countdown, today's events, today's releases against the
 * forecast and the high/medium events of each weekday.
 */
export function CalendarTiles({
  events,
  today,
  weekStart,
  now,
  timezone,
  onOpen,
  onDay,
}: {
  /** This week and the next, with the page's filters. */
  events: CalendarEvent[];
  today: string;
  weekStart: string;
  now: number;
  timezone: string;
  onOpen: (event: CalendarEvent) => void;
  onDay: (date: string) => void;
}) {
  const t = useT().calendar;
  const language = useLanguage();
  const todays = events.filter((e) => e.localDate === today);
  const next = events.find((e) => e.impact === 'high' && new Date(e.eventTime).getTime() > now);

  const releases = todays.filter(isRelease);
  const released = releases.filter((e) => e.actual != null);
  const better = released.filter((e) => surpriseOf(e) === 'better').length;
  const worse = released.filter((e) => surpriseOf(e) === 'worse').length;

  const week = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)).map((date) => {
    const day = events.filter((e) => e.localDate === date);
    return { date, high: day.filter((e) => e.impact === 'high').length, medium: day.filter((e) => e.impact === 'medium').length };
  });
  const most = Math.max(1, ...week.map((d) => d.high + d.medium));
  const busiest = week.reduce((best, d) => (d.high > best.high ? d : best), week[0]!);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [@media(min-width:87.5rem)]:grid-cols-4">
      <div className={TILE}>
        <span className="eyebrow">{t.nextHigh}</span>
        {next ? (
          <>
            <span className={`${VALUE} ${minutesUntil(next.eventTime, now) < 30 ? 'text-sell' : 'text-accent-ink'}`}>{t.countdown(minutesUntil(next.eventTime, now))}</span>
            <button type="button" onClick={() => onOpen(next)} className="flex min-w-0 items-center gap-2 text-left text-sm font-bold hover:underline">
              <CurrencyFlag currency={next.currency} />
              <span className="truncate">{next.title}</span>
            </button>
            <span className="truncate text-xs text-dim">
              {next.localDate === today ? '' : `${weekdayName(next.localDate)}, `}
              {formatTime(next.eventTime, timezone)}
              {next.instruments.length > 0 &&
                ` · ${t.affects(
                  markets(next.instruments, language)
                    .slice(0, 3)
                    .map((m) => m.label)
                    .join(', '),
                )}`}
            </span>
          </>
        ) : (
          <span className="pt-1 text-sm text-dim">{t.noNextHigh}</span>
        )}
      </div>

      <div className={TILE}>
        <span className="eyebrow">{t.todayTile}</span>
        <span className={VALUE}>{t.eventsCount(todays.length)}</span>
        <span className="flex flex-wrap gap-1.5 pt-0.5">
          {EVENT_IMPACTS.map((impact) => {
            const n = todays.filter((e) => e.impact === impact).length;
            return n > 0 ? <ImpactPill key={impact} impact={impact} count={n} /> : null;
          })}
        </span>
      </div>

      <div className={TILE}>
        <span className="eyebrow">{t.releasesToday}</span>
        {releases.length === 0 ? (
          <span className="pt-1 text-sm text-dim">{t.noReleasesToday}</span>
        ) : (
          <>
            <span className={VALUE}>
              {released.length} <span className="text-base font-semibold text-dim">{t.releasedOf(releases.length)}</span>
            </span>
            <span className="text-xs text-dim">
              {released.length === 0 ? (
                t.noReleasesYet
              ) : (
                <>
                  <span className="font-semibold text-buy">▲ {t.better(better)}</span> · <span className="font-semibold text-sell">▼ {t.worse(worse)}</span> {t.vsForecast}
                </>
              )}
            </span>
          </>
        )}
      </div>

      <div className={TILE}>
        <span className="eyebrow">{t.thisWeek}</span>
        <div className="grid h-14 grid-cols-5 items-end gap-2" aria-label={t.weekLegend}>
          {week.map((d) => (
            <button
              key={d.date}
              type="button"
              onClick={() => onDay(d.date)}
              title={`${weekdayName(d.date)}: ${d.high} · ${d.medium}`}
              aria-label={t.openDay(weekdayName(d.date))}
              className="group flex h-full flex-col justify-end gap-0.5"
            >
              {d.high > 0 && <span className="w-full rounded-[3px] bg-sell group-hover:opacity-80" style={{ height: `${(d.high / most) * 34}px` }} />}
              {d.medium > 0 && <span className="w-full rounded-[3px] bg-warn group-hover:opacity-80" style={{ height: `${(d.medium / most) * 34}px` }} />}
              {d.high + d.medium === 0 && <span className="h-1 w-full rounded-[3px] bg-chip" />}
              <span className={`pt-1 text-center text-[11px] font-semibold capitalize ${d.date === today ? 'text-accent-ink' : 'text-dim'}`}>
                {weekdayName(d.date, 'short')}
              </span>
            </button>
          ))}
        </div>
        <span className="text-xs text-dim">{busiest.high > 0 ? t.busiest(weekdayName(busiest.date)) : t.quietWeek}</span>
      </div>
    </div>
  );
}
