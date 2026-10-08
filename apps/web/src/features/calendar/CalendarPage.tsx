import type { CalendarEvent } from '@trading/api/types';
import {
  CALENDAR_CURRENCIES,
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  EVENT_IMPACT_LABELS,
  EVENT_IMPACTS,
  toLocalDate,
  type EventCategory,
  type EventImpact,
} from '@trading/shared';
import { useCallback, useEffect, useState } from 'react';
import { useCalendar, useInstruments, useMe, useRefreshCalendar } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Chip, Segmented } from '../../components/ui/Field.tsx';
import { CurrencyFlag } from '../../components/ui/InstrumentBadge.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays, currentLocale, formatDate } from '../../lib/format.ts';
import { instrumentOptions } from '../../lib/instruments.ts';
import { CalendarTiles } from './CalendarTiles.tsx';
import { DayTimeline, MonthGrid, WeekBoard } from './CalendarViews.tsx';
import { EventDetails } from './EventDetails.tsx';
import { IMPACT_TONE, longDate, useNow } from './parts.tsx';

type View = 'day' | 'week' | 'month';

/** Every currency the Forex Factory feed publishes. */
const ALL_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];

const FILTERS_KEY = 'calendar-filters';

interface Filters {
  currencies: string[];
  impacts: EventImpact[];
  /** Empty for all; otherwise the one chosen type. */
  categories: EventCategory[];
}

const DEFAULT_FILTERS: Filters = { currencies: [...CALENDAR_CURRENCIES], impacts: [...EVENT_IMPACTS], categories: [] };

function loadFilters(): Filters {
  try {
    const saved: Filters = { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') };
    // Several types could be ticked before the filter became a drop-down.
    return saved.categories.length > 1 ? { ...saved, categories: [] } : saved;
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** Monday = 0 … Sunday = 6. */
const weekdayIndex = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const startOfWeek = (date: string) => addDays(date, -weekdayIndex(date));
const startOfMonth = (date: string) => `${date.slice(0, 8)}01`;
const endOfMonth = (date: string) => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const shiftMonth = (date: string, months: number) => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
};

function rangeFor(view: View, date: string) {
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') return { from: startOfWeek(date), to: addDays(startOfWeek(date), 6) };
  // The month grid shows whole weeks.
  return { from: startOfWeek(startOfMonth(date)), to: addDays(startOfWeek(endOfMonth(date)), 6) };
}

const groupByDay = (events: CalendarEvent[]) => {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.localDate, [...(byDay.get(e.localDate) ?? []), e]);
  return byDay;
};

export function CalendarPage() {
  const all = useT();
  const t = all.calendar;
  const language = useLanguage();
  const { data: me } = useMe();
  const { data: instruments } = useInstruments();
  const refresh = useRefreshCalendar();
  const timezone = me?.settings.timezone ?? 'Europe/Warsaw';
  const now = useNow();
  const today = toLocalDate(new Date(now), timezone);

  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [instrumentId, setInstrumentId] = useState('');
  const [open, setOpen] = useState<CalendarEvent | null>(null);
  const closeDetails = useCallback(() => setOpen(null), []);

  useEffect(() => setDate(toLocalDate(new Date(), timezone)), [timezone]);
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Filters just reset on the next visit.
    }
  }, [filters]);

  const query = {
    currencies: filters.currencies,
    impacts: filters.impacts,
    categories: filters.categories.length ? filters.categories : undefined,
    instrumentId: instrumentId || undefined,
  };
  const range = rangeFor(view, date);
  const { data, isFetching } = useCalendar({ ...range, ...query });
  // The tiles are about today and this week (plus the next, for the next important event).
  const thisWeek = startOfWeek(today);
  const { data: soon } = useCalendar({ from: thisWeek, to: addDays(thisWeek, 13), ...query });

  const toggle = <K extends 'currencies' | 'impacts'>(key: K, value: Filters[K][number]) =>
    setFilters((f) => {
      const list = f[key] as string[];
      return { ...f, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  const move = (step: number) => setDate((d) => (view === 'day' ? addDays(d, step) : view === 'week' ? addDays(d, 7 * step) : shiftMonth(d, step)));
  const openDay = (day: string) => {
    setDate(day);
    setView('day');
  };

  const title =
    view === 'day'
      ? longDate(date)
      : view === 'week'
        ? `${formatDate(range.from).slice(0, 5)} – ${formatDate(range.to)}`
        : `${all.months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

  const noCurrencies = filters.currencies.length === 0;
  const events = noCurrencies ? [] : (data?.events ?? []);
  const byDay = groupByDay(events);

  const coverage = data?.coverage;
  const outsideCoverage = coverage && (!coverage.from || !coverage.to || range.to < coverage.from || range.from > coverage.to);
  const emptyText = noCurrencies ? t.chooseCurrency : outsideCoverage ? t.outside(coverage?.from ? formatDate(coverage.from) : null) : t.noEvents;
  const empty = <p className="m-0 px-5 py-12 text-center text-sm text-dim">{emptyText}</p>;

  const separator = <span aria-hidden className="hidden w-px self-stretch bg-line sm:block" />;

  return (
    <main className="page">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <div className="grow" />
        <Segmented
          label={t.view}
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: t.day },
            { value: 'week', label: t.week },
            { value: 'month', label: t.month },
          ]}
        />
      </div>

      <CalendarTiles
        events={noCurrencies ? [] : (soon?.events ?? [])}
        today={today}
        weekStart={thisWeek}
        now={now}
        timezone={timezone}
        onOpen={setOpen}
        onDay={openDay}
      />

      <section aria-label={t.filters} className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <div role="group" aria-label={t.currency} className="flex flex-wrap gap-1.5">
          {ALL_CURRENCIES.map((c) => (
            <Chip key={c} active={filters.currencies.includes(c)} onClick={() => toggle('currencies', c)}>
              <CurrencyFlag currency={c} size={16} />
              {c}
            </Chip>
          ))}
        </div>
        {separator}
        <div role="group" aria-label={t.impact} className="flex flex-wrap gap-1.5">
          {EVENT_IMPACTS.map((impact) => (
            <Chip key={impact} active={filters.impacts.includes(impact)} onClick={() => toggle('impacts', impact)}>
              <span aria-hidden className={`size-2 rounded-full ${IMPACT_TONE[impact].dot}`} />
              {EVENT_IMPACT_LABELS[language][impact]}
            </Chip>
          ))}
        </div>
        <div className="grow" />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <div className="min-w-0 grow sm:w-52 sm:grow-0">
            <Select
              aria-label={t.category}
              value={filters.categories[0] ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, categories: v ? [v as EventCategory] : [] }))}
              options={[
                { value: '', label: `${t.category}: ${all.common.all.toLowerCase()}` },
                ...EVENT_CATEGORIES.map((c) => ({ value: c, label: EVENT_CATEGORY_LABELS[language][c] })),
              ]}
            />
          </div>
          <div className="min-w-0 grow sm:w-56 sm:grow-0">
            <Select
              aria-label={t.instrument}
              value={instrumentId}
              onChange={setInstrumentId}
              options={[
                { value: '', label: `${t.instrument}: ${all.common.all.toLowerCase()}` },
                ...instrumentOptions(instruments ?? [], { label: (i) => `${i.symbol} · ${i.currencies.join(', ')}`, favorites: all.instruments.favorites, others: all.instruments.others }),
              ]}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 min-w-0 text-lg font-bold first-letter:uppercase">{title}</h2>
        {isFetching && <span className="font-mono text-xs text-dim">…</span>}
        <div className="grow" />
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => move(-1)} aria-label={t.prevPeriod}>
            ‹
          </Button>
          <Button size="sm" onClick={() => setDate(today)}>
            {t.today}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => move(1)} aria-label={t.nextPeriod}>
            ›
          </Button>
        </div>
      </div>

      {view === 'week' ? (
        events.length === 0 ? (
          <div className="card">{empty}</div>
        ) : (
          <WeekBoard from={range.from} byDay={byDay} today={today} timezone={timezone} onOpen={setOpen} onDay={openDay} />
        )
      ) : view === 'month' ? (
        <div className="card">
          <MonthGrid from={range.from} to={range.to} month={date.slice(0, 7)} byDay={byDay} today={today} weekdays={all.weekdays} onDay={openDay} />
        </div>
      ) : (
        <div className="card">{events.length === 0 ? empty : <DayTimeline date={date} events={events} today={today} now={now} timezone={timezone} onOpen={setOpen} />}</div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-dim">
        <span>
          {t.source(timezone)}
          {coverage?.from && coverage.to && t.coverage(formatDate(coverage.from), formatDate(coverage.to))}
          {coverage?.fetchedAt && t.fetched(new Date(coverage.fetchedAt).toLocaleString(currentLocale(), { timeZone: timezone }))}
        </span>
        <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? t.fetching : t.refresh}
        </Button>
        {refresh.data && 'message' in refresh.data && <span>{refresh.data.message}</span>}
      </div>

      {open && <EventDetails event={open} timezone={timezone} now={now} onClose={closeDetails} />}
    </main>
  );
}
