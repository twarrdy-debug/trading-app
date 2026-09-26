import type { CalendarEvent } from '@trading/api/types';
import {
  CALENDAR_CURRENCIES,
  findPairBySymbol,
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS,
  EVENT_IMPACT_LABELS,
  EVENT_IMPACTS,
  toLocalDate,
  type EventCategory,
  type EventImpact,
} from '@trading/shared';
import { useEffect, useState } from 'react';
import { useCalendar, useInstruments, useMe, useRefreshCalendar } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Segmented, Select } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { addDays } from '../../lib/format.ts';

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

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

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

/** "XAUUSD, GC1, MGC1, NQ1…" → "Złoto, Nasdaq 100…": one chip per market instead of per contract. */
function markets(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => findPairBySymbol(s)?.pair.label ?? s))];
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
  new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

export function ImpactFlag({ impact, size = 16 }: { impact: EventImpact; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={`Wpływ: ${EVENT_IMPACT_LABELS[impact]}`} className="shrink-0">
      <title>{`Wpływ: ${EVENT_IMPACT_LABELS[impact]}`}</title>
      <path d="M3 1.5v13" stroke="var(--dim)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3.8 2h9.2l-2.4 3.5L13 9H3.8Z" fill={IMPACT_COLOR[impact]} />
    </svg>
  );
}

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 border px-2.5 text-xs font-semibold tracking-[0.06em] transition ${
        active ? 'border-accent bg-accent/15 text-ink' : 'border-line text-dim hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function EventRow({ event, timezone, compact = false }: { event: CalendarEvent; timezone: string; compact?: boolean }) {
  const time =
    event.impact === 'holiday'
      ? 'Cały dzień'
      : new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(event.eventTime));
  return (
    <li
      className={`grid items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3 last:border-b-0 ${
        compact
          ? 'grid-cols-[64px_44px_20px_minmax(0,1fr)] md:grid-cols-[64px_44px_20px_minmax(0,1fr)_90px_90px]'
          : 'grid-cols-[64px_44px_20px_minmax(0,1fr)] md:grid-cols-[72px_48px_20px_minmax(0,1fr)_150px_90px_90px]'
      } ${event.impact === 'high' ? 'bg-warn-bg' : ''}`}
    >
      <span className="font-mono text-sm">{time}</span>
      <span className="font-mono text-sm font-semibold">{event.currency}</span>
      <ImpactFlag impact={event.impact} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold">{event.title}</span>
        <span className="flex flex-wrap gap-1">
          {compact && <span className="font-mono text-[11px] text-dim">{EVENT_CATEGORY_LABELS[event.category]}</span>}
          {markets(event.instruments).map((market) => (
            <span key={market} className="border border-line px-1.5 text-[10px] text-dim" title={event.instruments.join(', ')}>
              {market}
            </span>
          ))}
        </span>
      </span>
      {!compact && <span className="hidden text-xs text-dim md:inline">{EVENT_CATEGORY_LABELS[event.category]}</span>}
      <span className="hidden text-right font-mono text-xs md:inline">
        <span className="text-dim">Prog. </span>
        {event.forecast ?? '—'}
      </span>
      <span className="hidden text-right font-mono text-xs md:inline">
        <span className="text-dim">Pop. </span>
        {event.previous ?? '—'}
      </span>
    </li>
  );
}

export function CalendarPage() {
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
        ? `${range.from.slice(8)}.${range.from.slice(5, 7)} – ${range.to.slice(8)}.${range.to.slice(5, 7)}.${range.to.slice(0, 4)}`
        : `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

  const events = data?.events ?? [];
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.localDate, [...(byDay.get(e.localDate) ?? []), e]);

  const coverage = data?.coverage;
  const outsideCoverage =
    coverage && (!coverage.from || !coverage.to || range.to < coverage.from || range.from > coverage.to);
  const noCurrencies = filters.currencies.length === 0;

  const emptyText = noCurrencies
    ? 'Wybierz co najmniej jedną walutę.'
    : outsideCoverage
      ? `Brak danych dla tego okresu. Forex Factory udostępnia tylko bieżący tydzień, a aplikacja zapisuje kolejne tygodnie${
          coverage?.from ? ` od ${coverage.from.split('-').reverse().join('.')}` : ''
        }.`
      : 'Brak wydarzeń spełniających filtry.';

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="m-0 text-lg font-semibold tracking-[0.14em] uppercase">Kalendarz ekonomiczny</h1>
        <div className="grow" />
        <Segmented
          label="Widok"
          value={view}
          onChange={setView}
          options={[
            { value: 'day', label: 'Dzień' },
            { value: 'week', label: 'Tydzień' },
            { value: 'month', label: 'Miesiąc' },
          ]}
        />
      </div>

      <Panel className="flex flex-col gap-4 p-5" aria-label="Filtry kalendarza">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-2 w-20">Waluta</span>
          {ALL_CURRENCIES.map((c) => (
            <Chip key={c} active={filters.currencies.includes(c)} onClick={() => toggle('currencies', c)}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-2 w-20">Wpływ</span>
          {EVENT_IMPACTS.map((impact) => (
            <Chip key={impact} active={filters.impacts.includes(impact)} onClick={() => toggle('impacts', impact)}>
              <ImpactFlag impact={impact} size={14} />
              {EVENT_IMPACT_LABELS[impact]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-2 w-20">Rodzaj</span>
          <Chip active={filters.categories.length === 0} onClick={() => setFilters((f) => ({ ...f, categories: [] }))}>
            Wszystkie
          </Chip>
          {EVENT_CATEGORIES.map((category) => (
            <Chip key={category} active={filters.categories.includes(category)} onClick={() => toggle('categories', category)}>
              {EVENT_CATEGORY_LABELS[category]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-2 w-20">Instrument</span>
          <div className="w-64">
            <Select aria-label="Instrument" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)}>
              <option value="">Wszystkie</option>
              {instruments?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol} · {i.currencies.join(', ')}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Panel>

      <Panel
        brackets
        title={<span className="capitalize">{title}</span>}
        actions={
          <div className="flex items-center gap-2">
            {isFetching && <span className="font-mono text-xs text-dim">…</span>}
            <Button size="sm" variant="ghost" onClick={() => move(-1)} aria-label="Poprzedni okres">
              ‹
            </Button>
            <Button size="sm" onClick={() => setDate(today)}>
              Dziś
            </Button>
            <Button size="sm" variant="ghost" onClick={() => move(1)} aria-label="Następny okres">
              ›
            </Button>
          </div>
        }
      >
        {view === 'month' ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[700px] grid-cols-7">
              {WEEKDAYS.map((d) => (
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
                    aria-label={`${longDate(day)}: ${dayEvents.length} wydarzeń`}
                    className={`flex min-h-24 flex-col gap-2 border-r border-b border-line p-2.5 text-left transition hover:bg-raised [&:nth-child(7n)]:border-r-0 ${
                      inMonth ? '' : 'opacity-40'
                    } ${day === today ? 'bg-raised' : ''}`}
                  >
                    <span className={`font-mono text-sm ${day === today ? 'font-bold text-accent' : ''}`}>{Number(day.slice(8))}</span>
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
                    className={`m-0 flex items-center justify-between bg-chip px-5 py-2 text-xs font-semibold tracking-[0.12em] uppercase ${
                      day === today ? 'text-accent' : ''
                    }`}
                  >
                    <span className="capitalize">{longDate(day)}</span>
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
          Źródło: Forex Factory. Godziny w strefie {timezone}.
          {coverage?.from &&
            coverage.to &&
            ` Dane dostępne od ${coverage.from.split('-').reverse().join('.')} do ${coverage.to.split('-').reverse().join('.')}.`}
          {coverage?.fetchedAt && ` Ostatnie pobranie: ${new Date(coverage.fetchedAt).toLocaleString('pl-PL', { timeZone: timezone })}.`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? 'Pobieram…' : 'Odśwież'}
        </Button>
        {refresh.data && 'message' in refresh.data && <span>{refresh.data.message}</span>}
      </div>
    </main>
  );
}
