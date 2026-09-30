import type { CalendarEvent } from '@trading/api/types';
import {
  CALENDAR_CURRENCIES,
  findPairBySymbol,
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  EVENT_IMPACT_LABELS,
  EVENT_IMPACTS,
  releaseSurprise,
  toLocalDate,
  type EventCategory,
  type EventImpact,
  type Language,
} from '@trading/shared';
import { useEffect, useState } from 'react';
import { useCalendar, useInstruments, useMe, useRefreshCalendar } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Chip, Segmented } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays, currentLocale, formatDate } from '../../lib/format.ts';

type View = 'day' | 'week' | 'month';

/** Every currency the Forex Factory feed publishes. */
const ALL_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];

/** Forex Factory's impact colours: red, orange, yellow folders; grey for holidays. */
const IMPACT_COLOR: Record<EventImpact, string> = {
  high: '#E5392F',
  medium: '#F28C28',
  low: '#E8C53A',
  holiday: '#8B98A5',
};


/** Actual against the forecast, from the currency's point of view (green better, red worse). */
export const ACTUAL_COLOR = { better: 'text-buy', worse: 'text-sell', inline: '' } as const;

const FILTERS_KEY = 'calendar-filters';

interface Filters {
  currencies: string[];
  impacts: EventImpact[];
  categories: EventCategory[];
}

const DEFAULT_FILTERS: Filters = { currencies: [...CALENDAR_CURRENCIES], impacts: [...EVENT_IMPACTS], categories: [] };

function loadFilters(): Filters {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** "XAUUSD, GC1, MGC1, NQ1…" → "Gold, Nasdaq 100…": one chip per market instead of per contract. */
function markets(symbols: string[], language: Language): string[] {
  return [...new Set(symbols.map((s) => findPairBySymbol(s)?.pair.label[language] ?? s))];
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
  const from = startOfWeek(startOfMonth(date));
  const to = addDays(startOfWeek(endOfMonth(date)), 6);
  return { from, to };
}

const longDate = (date: string) =>
  new Intl.DateTimeFormat(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

export function ImpactFlag({ impact, size = 16 }: { impact: EventImpact; size?: number }) {
  const t = useT().calendar;
  const label = t.impactLabel(EVENT_IMPACT_LABELS[useLanguage()][impact]);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      <path d="M3 1.5v13" stroke="var(--dim)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3.8 2h9.2l-2.4 3.5L13 9H3.8Z" fill={IMPACT_COLOR[impact]} />
    </svg>
  );
}

function EventRow({ event, timezone, compact = false }: { event: CalendarEvent; timezone: string; compact?: boolean }) {
  const t = useT().calendar;
  const language = useLanguage();
  // The actual comes from FinancialJuice headlines matched to the event (services/news.ts).
  const surprise = event.actual
    ? releaseSurprise({ name: event.title, actual: event.actual, forecast: event.forecast, previous: event.previous, revision: null })
    : null;
  const time =
    event.impact === 'holiday'
      ? t.allDay
      : new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(event.eventTime));
  return (
    <li
      className={`grid items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3 last:border-b-0 ${
        compact
          ? 'grid-cols-[64px_44px_20px_minmax(0,1fr)] md:grid-cols-[64px_44px_20px_minmax(0,1fr)_110px_90px_90px]'
          : 'grid-cols-[64px_44px_20px_minmax(0,1fr)] md:grid-cols-[72px_48px_20px_minmax(0,1fr)_150px_110px_90px_90px]'
      } ${event.impact === 'high' ? 'bg-warn-bg' : ''}`}
    >
      <span className="font-mono text-sm">{time}</span>
      <span className="font-mono text-sm font-semibold">{event.currency}</span>
      <ImpactFlag impact={event.impact} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold">{event.title}</span>
        <span className="flex flex-wrap gap-1">
          {compact && <span className="font-mono text-[11px] text-dim">{EVENT_CATEGORY_LABELS[language][event.category]}</span>}
          {markets(event.instruments, language).map((market) => (
            <span key={market} className="rounded-md bg-chip px-1.5 py-0.5 text-[10px] font-semibold text-dim" title={event.instruments.join(', ')}>
              {market}
            </span>
          ))}
        </span>
      </span>
      {!compact && <span className="hidden text-xs text-dim md:inline">{EVENT_CATEGORY_LABELS[language][event.category]}</span>}
      <span className={`hidden text-right font-mono text-xs font-semibold md:inline ${ACTUAL_COLOR[surprise ?? 'inline']}`}>
        <span className="font-normal text-dim">{t.actual} </span>
        {event.actual ?? '—'}
      </span>
      <span className="hidden text-right font-mono text-xs md:inline">
        <span className="text-dim">{t.forecast} </span>
        {event.forecast ?? '—'}
      </span>
      <span className="hidden text-right font-mono text-xs md:inline">
        <span className="text-dim">{t.previous} </span>
        {event.previous ?? '—'}
      </span>
    </li>
  );
}

export function CalendarPage() {
  const all = useT();
  const t = all.calendar;
  const language = useLanguage();
  const { data: me } = useMe();
  const { data: instruments } = useInstruments();
  const refresh = useRefreshCalendar();
  const timezone = me?.settings.timezone ?? 'Europe/Warsaw';
  const today = toLocalDate(new Date(), timezone);

  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [instrumentId, setInstrumentId] = useState('');

  useEffect(() => setDate(toLocalDate(new Date(), timezone)), [timezone]);
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Filters just reset on the next visit.
    }
  }, [filters]);

  const range = rangeFor(view, date);
  const { data, isFetching } = useCalendar({
    ...range,
    currencies: filters.currencies,
    impacts: filters.impacts,
    categories: filters.categories.length ? filters.categories : undefined,
    instrumentId: instrumentId || undefined,
  });

  const toggle = <K extends keyof Filters>(key: K, value: Filters[K][number]) =>
    setFilters((f) => {
      const list = f[key] as string[];
      return { ...f, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  const move = (step: number) =>
    setDate((d) => (view === 'day' ? addDays(d, step) : view === 'week' ? addDays(d, 7 * step) : shiftMonth(d, step)));

  const title =
    view === 'day'
      ? longDate(date)
      : view === 'week'
        ? `${formatDate(range.from).slice(0, 5)} – ${formatDate(range.to)}`
        : `${all.months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

  const events = data?.events ?? [];
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.localDate, [...(byDay.get(e.localDate) ?? []), e]);

  const coverage = data?.coverage;
  const outsideCoverage =
    coverage && (!coverage.from || !coverage.to || range.to < coverage.from || range.from > coverage.to);
  const noCurrencies = filters.currencies.length === 0;

  const emptyText = noCurrencies
    ? t.chooseCurrency
    : outsideCoverage
      ? t.outside(coverage?.from ? formatDate(coverage.from) : null)
      : t.noEvents;

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
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

      <Panel className="flex flex-col gap-4 p-5" aria-label={t.filters}>
        <div className="flex items-start gap-2">
          <span className="eyebrow w-20 shrink-0 pt-2">{t.currency}</span>
          <div className="flex min-w-0 grow flex-wrap items-center gap-2">
            {ALL_CURRENCIES.map((c) => (
              <Chip key={c} active={filters.currencies.includes(c)} onClick={() => toggle('currencies', c)}>
                {c}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="eyebrow w-20 shrink-0 pt-2">{t.impact}</span>
          <div className="flex min-w-0 grow flex-wrap items-center gap-2">
            {EVENT_IMPACTS.map((impact) => (
              <Chip key={impact} active={filters.impacts.includes(impact)} onClick={() => toggle('impacts', impact)}>
                <ImpactFlag impact={impact} size={14} />
                {EVENT_IMPACT_LABELS[language][impact]}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="eyebrow w-20 shrink-0 pt-2">{t.category}</span>
          <div className="flex min-w-0 grow flex-wrap items-center gap-2">
            <Chip active={filters.categories.length === 0} onClick={() => setFilters((f) => ({ ...f, categories: [] }))}>
              {all.common.all}
            </Chip>
            {EVENT_CATEGORIES.map((category) => (
              <Chip key={category} active={filters.categories.includes(category)} onClick={() => toggle('categories', category)}>
                {EVENT_CATEGORY_LABELS[language][category]}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="eyebrow w-20 shrink-0 pt-2">{t.instrument}</span>
          <div className="flex min-w-0 grow flex-wrap items-center gap-2">
            <div className="w-64">
              <Select
                aria-label={t.instrument}
                value={instrumentId}
                onChange={setInstrumentId}
                options={[
                  { value: '', label: all.common.all },
                  ...(instruments ?? []).map((i) => ({ value: i.id, label: `${i.symbol} · ${i.currencies.join(', ')}` })),
                ]}
              />
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title={<span className="inline-block first-letter:uppercase">{title}</span>}
        actions={
          <div className="flex items-center gap-2">
            {isFetching && <span className="font-mono text-xs text-dim">…</span>}
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
        }
      >
        {view === 'month' ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[700px] grid-cols-7">
              {all.weekdays.map((d) => (
                <span key={d} className="eyebrow border-b border-line px-3 py-2">
                  {d}
                </span>
              ))}
              {Array.from({ length: Math.round((new Date(`${range.to}T12:00:00Z`).getTime() - new Date(`${range.from}T12:00:00Z`).getTime()) / 86_400_000) + 1 }, (_, i) => {
                const day = addDays(range.from, i);
                const dayEvents = noCurrencies ? [] : (byDay.get(day) ?? []);
                const inMonth = day.slice(0, 7) === date.slice(0, 7);
                const counts = EVENT_IMPACTS.map((impact) => [impact, dayEvents.filter((e) => e.impact === impact).length] as const).filter(
                  ([, n]) => n > 0,
                );
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      setDate(day);
                      setView('day');
                    }}
                    aria-label={t.eventsOnDay(longDate(day), dayEvents.length)}
                    className={`flex min-h-24 flex-col gap-2 border-r border-b border-line p-2.5 text-left transition hover:bg-raised [&:nth-child(7n)]:border-r-0 ${
                      inMonth ? '' : 'opacity-40'
                    } ${day === today ? 'bg-raised' : ''}`}
                  >
                    <span className={`font-mono text-sm ${day === today ? 'font-bold text-accent-ink' : ''}`}>{Number(day.slice(8))}</span>
                    <span className="flex flex-wrap gap-x-2 gap-y-1">
                      {counts.map(([impact, n]) => (
                        <span key={impact} className="flex items-center gap-0.5 font-mono text-[11px] text-dim">
                          <ImpactFlag impact={impact} size={12} />
                          {n}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : events.length === 0 || noCurrencies ? (
          <p className="m-0 px-5 py-10 text-center text-sm text-dim">{emptyText}</p>
        ) : view === 'day' ? (
          <ul className="m-0 list-none p-0">
            {events.map((e) => (
              <EventRow key={e.id} event={e} timezone={timezone} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col">
            {Array.from({ length: 7 }, (_, i) => addDays(range.from, i)).map((day) => {
              const dayEvents = byDay.get(day) ?? [];
              return (
                <section key={day} aria-label={longDate(day)} className="border-b border-line last:border-b-0">
                  <h3
                    className={`m-0 flex items-center justify-between bg-raised px-5 py-2 text-[13px] font-bold ${
                      day === today ? 'text-accent-ink' : ''
                    }`}
                  >
                    <span className="inline-block first-letter:uppercase">{longDate(day)}</span>
                    <span className="font-mono text-dim">{dayEvents.length}</span>
                  </h3>
                  {dayEvents.length > 0 && (
                    <ul className="m-0 list-none p-0">
                      {dayEvents.map((e) => (
                        <EventRow key={e.id} event={e} timezone={timezone} compact />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Panel>

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
    </main>
  );
}
