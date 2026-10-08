import type { CalendarEvent } from '@trading/api/types';
import { EVENT_CATEGORY_LABELS } from '@trading/shared';
import { Fragment, useState, type ReactNode } from 'react';
import { CurrencyFlag } from '../../components/ui/InstrumentBadge.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays } from '../../lib/format.ts';
import { ACTUAL_COLOR, formatTime, IMPACT_TONE, ImpactPill, isRelease, longDate, MarketChips, minutesUntil, surpriseOf, weekdayName } from './parts.tsx';

type Open = (event: CalendarEvent) => void;

const isPast = (e: CalendarEvent, now: number) => new Date(e.eventTime).getTime() <= now;

/** Actual, forecast, previous: three small cells; the actual tinted by how it compares. */
function Figures({ event }: { event: CalendarEvent }) {
  const t = useT().calendar;
  const surprise = surpriseOf(event);
  const cell = (label: string, value: string | null, extra = '') => (
    <span className={`flex min-w-0 flex-col rounded-[10px] px-2.5 py-1 text-right ${extra || 'bg-raised'}`}>
      <span className="text-[10.5px] font-semibold text-dim">{label}</span>
      <span className="truncate font-mono text-[13px] font-bold">{value ?? '—'}</span>
    </span>
  );
  return (
    <span className="col-span-full grid grid-cols-3 gap-1.5 md:col-span-1 md:w-[15.5rem]">
      {cell(t.actual, event.actual, surprise === 'better' ? `bg-buy-soft ${ACTUAL_COLOR.better}` : surprise === 'worse' ? `bg-sell-soft ${ACTUAL_COLOR.worse}` : '')}
      {cell(t.forecastLong, event.forecast)}
      {cell(t.previousLong, event.previous)}
    </span>
  );
}

function NowLine({ now, timezone }: { now: number; timezone: string }) {
  const t = useT().calendar;
  return (
    <li aria-label={t.now(formatTime(new Date(now).toISOString(), timezone))} className="flex items-center gap-2.5 px-3 py-0.5 text-[11.5px] font-bold text-accent-ink">
      <span aria-hidden className="calendar-now size-2.5 shrink-0 rounded-full bg-accent" />
      {t.now(formatTime(new Date(now).toISOString(), timezone))}
      <span aria-hidden className="h-0.5 grow rounded-full bg-accent" />
    </li>
  );
}

/** One day as a timeline: past events dimmed, a "now" line today, high impact tinted red. */
export function DayTimeline({ date, events, today, now, timezone, onOpen }: { date: string; events: CalendarEvent[]; today: string; now: number; timezone: string; onOpen: Open }) {
  const t = useT().calendar;
  const language = useLanguage();
  const isToday = date === today;
  // The line goes before the first event still to come (all-day holidays stay above it).
  const nowAt = isToday ? events.findIndex((e) => e.impact !== 'holiday' && !isPast(e, now)) : -2;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-2 sm:p-3">
      {events.map((e, i) => {
        const upcoming = isToday && !isPast(e, now);
        return (
          <Fragment key={e.id}>
            {i === nowAt && <NowLine now={now} timezone={timezone} />}
            <li>
              <button
                type="button"
                onClick={() => onOpen(e)}
                className={`grid w-full grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-[14px] px-3 py-2.5 text-left transition md:grid-cols-[3.5rem_4.75rem_minmax(0,1fr)_auto] ${
                  e.impact === 'high' ? 'bg-sell-soft hover:brightness-110' : 'hover:bg-raised'
                } ${isToday && !upcoming && e.impact !== 'holiday' ? 'opacity-60 hover:opacity-100' : ''}`}
              >
                <span className="font-mono text-sm font-bold">{e.impact === 'holiday' ? <span className="text-xs">{t.allDay}</span> : formatTime(e.eventTime, timezone)}</span>
                <span className="hidden items-center gap-1.5 text-[13px] font-bold md:flex">
                  <CurrencyFlag currency={e.currency} />
                  {e.currency}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-bold">{e.title}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 flex items-center gap-1 text-[12px] font-bold md:hidden">
                      <CurrencyFlag currency={e.currency} size={15} />
                      {e.currency}
                    </span>
                    <ImpactPill impact={e.impact} />
                    {upcoming && e.impact === 'high' && <span className="px-1 text-[11px] font-bold text-sell">{t.countdown(minutesUntil(e.eventTime, now))}</span>}
                    <span className="px-1 text-[11px] text-dim">{EVENT_CATEGORY_LABELS[language][e.category]}</span>
                    <MarketChips symbols={e.instruments} />
                  </span>
                </span>
                {(isRelease(e) || e.actual) && <Figures event={e} />}
              </button>
            </li>
          </Fragment>
        );
      })}
      {isToday && nowAt === -1 && <NowLine now={now} timezone={timezone} />}
    </ul>
  );
}

/** Impact mix of a day as one bar: red high, amber medium, grey low. */
function ImpactBar({ events }: { events: CalendarEvent[] }) {
  const parts = (['high', 'medium', 'low'] as const).map((impact) => [impact, events.filter((e) => e.impact === impact).length] as const);
  return (
    <span aria-hidden className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
      {parts.map(([impact, n]) => (n > 0 ? <span key={impact} className={`${IMPACT_TONE[impact].dot} ${impact === 'low' ? 'opacity-30' : ''}`} style={{ flexGrow: n }} /> : null))}
      {events.length === 0 && <span className="grow bg-chip" />}
    </span>
  );
}

function BoardRow({ event, timezone, onOpen }: { event: CalendarEvent; timezone: string; onOpen: Open }) {
  const t = useT().calendar;
  const surprise = surpriseOf(event);
  const tone = event.impact === 'high' ? 'bg-sell-soft' : event.impact === 'medium' ? 'bg-raised ring-1 ring-warn/40 ring-inset' : 'bg-raised';
  return (
    <button type="button" onClick={() => onOpen(event)} title={event.title} className={`grid w-full grid-cols-[2.6rem_1.1rem_minmax(0,1fr)] items-start gap-x-1.5 gap-y-0.5 rounded-[10px] px-2 py-1.5 text-left text-xs transition hover:brightness-110 ${tone}`}>
      <span className={`font-mono font-bold ${event.impact === 'high' ? 'text-sell' : 'text-dim'}`}>{formatTime(event.eventTime, timezone)}</span>
      <CurrencyFlag currency={event.currency} size={16} />
      <span className="line-clamp-2 font-bold break-words">{event.title}</span>
      {(event.actual || event.forecast) && (
        <span className="col-start-3 truncate font-mono text-[11px] text-dim">
          {event.actual && <span className={`font-bold ${surprise ? ACTUAL_COLOR[surprise] : 'text-ink'}`}>{event.actual}</span>}
          {event.actual && event.forecast && ' · '}
          {event.forecast && `${t.forecast} ${event.forecast}`}
        </span>
      )}
    </button>
  );
}

function BoardDay({ date, events, today, timezone, onOpen, onDay }: { date: string; events: CalendarEvent[]; today: string; timezone: string; onOpen: Open; onDay: (date: string) => void }) {
  const t = useT().calendar;
  const [expanded, setExpanded] = useState(false);
  const holidays = events.filter((e) => e.impact === 'holiday');
  const timed = events.filter((e) => e.impact !== 'holiday');
  const important = timed.filter((e) => e.impact !== 'low');
  // Low-impact events wait behind "+n" unless the day has nothing else.
  const shown = expanded || important.length === 0 ? timed : important;
  const hiddenLow = timed.length - shown.length;
  return (
    <section aria-label={longDate(date)} className={`card flex min-w-0 flex-col gap-2.5 p-3 ${date === today ? 'ring-2 ring-accent' : ''}`}>
      <button type="button" onClick={() => onDay(date)} aria-label={t.openDay(longDate(date))} className="flex items-baseline justify-between gap-2 rounded-lg px-1 text-left hover:bg-raised">
        <span className={`text-[22px] font-bold tabular-nums ${date === today ? 'text-accent-ink' : ''}`}>{Number(date.slice(8))}</span>
        <span className={`text-xs font-semibold capitalize ${date === today ? 'text-accent-ink' : 'text-dim'}`}>
          {weekdayName(date)}
          {date === today && ` · ${t.today.toLowerCase()}`}
        </span>
      </button>
      <ImpactBar events={timed} />
      {holidays.map((e) => (
        <button key={e.id} type="button" onClick={() => onOpen(e)} className="flex items-center gap-1.5 truncate rounded-lg px-1 text-left text-[11px] font-semibold text-dim hover:text-ink">
          <CurrencyFlag currency={e.currency} size={14} />
          <span className="truncate">{e.title}</span>
        </button>
      ))}
      <div className="flex flex-col gap-1.5">
        {shown.map((e) => (
          <BoardRow key={e.id} event={e} timezone={timezone} onOpen={onOpen} />
        ))}
        {events.length === 0 && <span className="px-1 py-2 text-xs text-dim">{t.noEvents}</span>}
      </div>
      {(hiddenLow > 0 || expanded) && important.length > 0 && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="self-start rounded-lg px-1.5 py-0.5 text-xs font-semibold text-dim hover:bg-chip hover:text-ink">
          {expanded ? t.showLess : t.moreLow(hiddenLow)}
        </button>
      )}
    </section>
  );
}

/** A week as day cards like the dashboard's results calendar; weekends only when they have events. */
export function WeekBoard({ from, byDay, today, timezone, onOpen, onDay }: { from: string; byDay: Map<string, CalendarEvent[]>; today: string; timezone: string; onOpen: Open; onDay: (date: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d, i) => i < 5 || (byDay.get(d)?.length ?? 0) > 0);
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 ${days.length > 5 ? '[@media(min-width:90rem)]:grid-cols-4 [@media(min-width:120rem)]:grid-cols-7' : '[@media(min-width:90rem)]:grid-cols-5'}`}>
      {days.map((d) => (
        <BoardDay key={d} date={d} events={byDay.get(d) ?? []} today={today} timezone={timezone} onOpen={onOpen} onDay={onDay} />
      ))}
    </div>
  );
}

/** A month of day tiles with the impact counts and the day's high-impact titles. */
export function MonthGrid({ from, to, month, byDay, today, weekdays, onDay }: { from: string; to: string; month: string; byDay: Map<string, CalendarEvent[]>; today: string; weekdays: string[]; onDay: (date: string) => void }) {
  const t = useT().calendar;
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="grid grid-cols-7 gap-1.5 p-3 sm:gap-2 sm:p-4">
      {weekdays.map((d) => (
        <span key={d} className="pb-1 text-center text-xs font-semibold text-dim">
          {d}
        </span>
      ))}
      {days.map((day) => {
        const events = byDay.get(day) ?? [];
        const inMonth = day.slice(0, 7) === month;
        const high = events.filter((e) => e.impact === 'high');
        const counts = (['high', 'medium', 'low'] as const).map((impact) => [impact, events.filter((e) => e.impact === impact).length] as const).filter(([, n]) => n > 0);
        const cell: ReactNode = (
          <>
            <span className={`text-xs font-bold sm:text-sm ${day === today ? 'text-accent-ink' : ''}`}>{Number(day.slice(8))}</span>
            <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
              {high.slice(0, 2).map((e) => (
                <span key={e.id} className="flex min-w-0 items-center gap-1 text-[11px] font-semibold">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-sell" />
                  <span className="truncate">
                    {e.currency} {e.title}
                  </span>
                </span>
              ))}
              {high.length > 2 && <span className="text-[11px] text-dim">+{high.length - 2}</span>}
            </span>
            <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
              {counts.map(([impact, n]) => (
                <span key={impact} className="flex items-center gap-0.5 font-mono text-[10px] font-semibold text-dim sm:text-[11px]">
                  <span aria-hidden className={`size-1.5 rounded-full ${IMPACT_TONE[impact].dot}`} />
                  {n}
                </span>
              ))}
            </span>
          </>
        );
        return (
          <button
            key={day}
            type="button"
            onClick={() => onDay(day)}
            aria-label={t.eventsOnDay(longDate(day), events.length)}
            className={`flex min-h-16 min-w-0 flex-col justify-between gap-1 rounded-[10px] border p-1.5 text-left transition sm:min-h-26 sm:p-2.5 ${
              inMonth ? 'border-line bg-raised hover:border-dim' : 'border-transparent opacity-40 hover:opacity-70'
            } ${high.length > 0 && inMonth ? 'border-sell/30' : ''} ${day === today ? 'ring-2 ring-accent' : ''}`}
          >
            {cell}
          </button>
        );
      })}
    </div>
  );
}
