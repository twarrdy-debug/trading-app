import type { NewsItem, NewsResponse } from '@trading/api/types';
import {
  matchKeywords,
  NEWS_CURRENCIES,
  NEWS_CATEGORIES,
  NEWS_CATEGORY_LABELS,
  releaseSurprise,
  toLocalDate,
  type NewsCategory,
  type NewsData,
} from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { Fragment, useEffect, useState } from 'react';
import { useCalendar, useInstruments, useMe, useNews } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Chip, Input } from '../../components/ui/Field.tsx';
import { CurrencyFlag } from '../../components/ui/InstrumentBadge.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays, currentLocale } from '../../lib/format.ts';
import { instrumentOptions } from '../../lib/instruments.ts';
import { useNewsLive, useNewsScreen } from '../../lib/news-live.ts';
import { ACTUAL_COLOR, IMPACT_TONE, ImpactPill, minutesUntil, useNow } from '../calendar/parts.tsx';
import { KeywordAlerts } from './KeywordAlerts.tsx';

const FILTERS_KEY = 'news-filters';

interface Filters {
  /** Empty means all. */
  categories: NewsCategory[];
  currencies: string[];
  instrumentId: string;
  noise: boolean;
  important: boolean;
}

const DEFAULT_FILTERS: Filters = { categories: [], currencies: [], instrumentId: '', noise: false, important: false };

function loadFilters(): Filters {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_FILTERS;
  }
}

const timeOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));

const longDate = (date: string) =>
  new Intl.DateTimeFormat(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Category colours: macro data in the accent, central banks blue, geopolitics violet, the rest grey. */
const CATEGORY_TONE: Record<NewsCategory, string> = {
  data: 'bg-accent/15 text-accent-ink',
  central_bank: 'bg-info-soft text-info',
  politics: 'bg-chip text-ink',
  geopolitics: 'bg-violet-soft text-violet',
  markets: 'bg-chip text-ink',
  other: 'bg-chip text-dim',
};

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${className}`}>{children}</span>;
}

/** A released number as the calendar shows it: actual (tinted by the surprise), forecast, previous. */
function Release({ data, event, red }: { data: NewsData; event: NewsItem['event']; red: boolean }) {
  const all = useT();
  const t = all.news;
  const surprise = releaseSurprise(data);
  const mark = surprise === 'better' ? ' ▲' : surprise === 'worse' ? ' ▼' : '';
  const cell = (label: string, value: string | null, tone = '') => (
    <span className={`flex min-w-0 flex-col rounded-lg px-2 py-0.5 text-right ${tone || (red ? 'bg-black/20' : 'bg-raised')}`}>
      <span className={`text-[10px] font-semibold ${red ? 'text-on-breaking/80' : 'text-dim'}`}>{label}</span>
      <span className="truncate font-mono text-[12.5px] font-bold">{value ?? '—'}</span>
    </span>
  );
  const actualTone = red ? '' : surprise === 'better' ? `bg-buy-soft ${ACTUAL_COLOR.better}` : surprise === 'worse' ? `bg-sell-soft ${ACTUAL_COLOR.worse}` : '';
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm font-bold">
        {event && !red && (
          <span title={t.inCalendar(event.title)} aria-label={t.inCalendar(event.title)} className={`size-2 shrink-0 rounded-full ${IMPACT_TONE[event.impact].dot}`} />
        )}
        {data.name}
      </span>
      <span className="grid w-full max-w-[15rem] grid-cols-3 gap-1" title={surprise ? t[surprise] : undefined}>
        {cell(t.actual, data.actual ? `${data.actual}${mark}` : null, actualTone)}
        {cell(all.calendar.forecastLong, data.forecast)}
        {cell(all.calendar.previousLong, data.previous && data.revision ? `${data.previous} (${data.revision})` : data.previous)}
      </span>
    </div>
  );
}

function Headline({ item, keywords, timezone, fresh }: { item: NewsItem; keywords: string[]; timezone: string; fresh: boolean }) {
  const all = useT();
  const t = all.news;
  const language = useLanguage();
  const hits = matchKeywords(item.title, keywords);
  const rest = item.speaker ? item.title.slice(item.speaker.length + 1).trim() : item.title;
  const red = item.important;
  const dim = red ? 'text-on-breaking/80' : 'text-dim';

  return (
    <li
      title={red ? t.important : undefined}
      className={`grid grid-cols-[2.75rem_minmax(0,1fr)_auto] gap-x-3 px-5 py-2.5 transition ${
        red
          ? `mx-2 my-1 rounded-xl bg-breaking px-3 text-on-breaking ${hits.length ? 'shadow-[inset_4px_0_0_var(--accent)]' : ''}`
          : hits.length
            ? 'bg-accent/10 shadow-[inset_3px_0_0_var(--accent)]'
            : 'hover:bg-raised'
      } ${fresh && !red ? 'news-fresh shadow-[inset_3px_0_0_var(--accent)]' : ''}`}
    >
      <time dateTime={item.publishedAt} className={`pt-0.5 font-mono text-xs font-semibold ${dim}`}>
        {timeOf(item.publishedAt, timezone)}
      </time>
      <div className="flex min-w-0 flex-col gap-1.5">
        {item.data ? (
          <Release data={item.data} event={item.event} red={red} />
        ) : (
          <p className={`m-0 text-sm leading-snug ${red ? 'font-semibold' : ''}`}>
            {item.speaker && <span className="font-bold">{item.speaker}: </span>}
            {rest}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {item.currencies.map((c) =>
            red ? (
              <Pill key={c} className="bg-black/20 font-mono">
                {c}
              </Pill>
            ) : (
              <span key={c} title={c} className="flex items-center gap-1 text-[11px] font-bold text-dim">
                <CurrencyFlag currency={c} size={15} />
                {c}
              </span>
            ),
          )}
          <Pill className={red ? 'bg-black/20' : CATEGORY_TONE[item.category]}>{NEWS_CATEGORY_LABELS[language][item.category]}</Pill>
          {hits.map((k) => (
            <Pill key={k} className={red ? 'bg-accent text-on-accent' : 'bg-accent/20 text-ink'}>
              {k}
            </Pill>
          ))}
          {item.sourceName && <span className={`text-[11px] ${dim}`}>{item.sourceName}</span>}
        </div>
      </div>
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={t.open}
          title={t.open}
          className={`flex size-7 items-center justify-center rounded-lg transition ${red ? 'text-on-breaking/80 hover:bg-black/20 hover:text-on-breaking' : 'text-dim hover:bg-chip hover:text-ink'}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      ) : (
        <span />
      )}
    </li>
  );
}

function FeedStatus({ feed }: { feed: NewsResponse['feed'] | undefined }) {
  const t = useT().news;
  const { connected } = useNewsLive();
  if (!feed) return null;
  const [tone, text] = !feed.enabled
    ? ['bg-chip text-dim', t.paused]
    : feed.error
      ? ['bg-sell-soft text-sell', t.feedError(feed.error)]
      : connected && feed.live
        ? ['bg-buy-soft text-buy', t.live]
        : ['bg-chip text-dim', t.connecting];
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-dim">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
        <span className={`size-1.5 rounded-full bg-current ${connected && feed.live && !feed.error ? 'animate-pulse' : ''}`} aria-hidden />
        {text}
      </span>
      {feed.mode === 'rss' && !feed.error && <span className="hidden sm:inline">{t.rssMode}</span>}
    </span>
  );
}

/** The next calendar events: the first with a countdown, the rest as a short list. */
function Upcoming({ timezone }: { timezone: string }) {
  const all = useT();
  const t = all.news;
  const now = useNow(30_000);
  const today = toLocalDate(new Date(now), timezone);
  const { data } = useCalendar({ from: today, to: addDays(today, 1), impacts: ['high', 'medium'] });
  // Just released events stay a few minutes, so their actual shows up here too.
  const events = (data?.events ?? []).filter((e) => new Date(e.eventTime).getTime() > now - 10 * 60_000).slice(0, 6);
  const next = events.find((e) => new Date(e.eventTime).getTime() > now);

  return (
    <section aria-label={t.upcoming} className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[15px] font-bold">{t.upcoming}</h2>
        <Link to="/kalendarz" className="text-xs font-semibold text-accent-ink no-underline hover:underline">
          {t.openCalendar}
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="m-0 text-xs text-dim">{t.noUpcoming}</p>
      ) : (
        <>
          {next && (
            <div className="flex flex-col gap-1 rounded-xl bg-raised px-3 py-2.5">
              <span className="flex items-center gap-2">
                <ImpactPill impact={next.impact} />
                <span className="truncate text-[13px] font-bold" title={next.title}>
                  {next.title}
                </span>
              </span>
              <span className="text-xl font-bold text-accent-ink">{all.calendar.countdown(minutesUntil(next.eventTime, now))}</span>
            </div>
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {events
              .filter((e) => e !== next)
              .map((e) => (
                <li key={e.id} className="grid grid-cols-[2.6rem_1rem_minmax(0,1fr)] items-center gap-x-2 py-1">
                  <span className="font-mono text-xs text-dim">{timeOf(e.eventTime, timezone)}</span>
                  <CurrencyFlag currency={e.currency} size={16} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${IMPACT_TONE[e.impact].dot}`} />
                      <span className="truncate text-[13px] font-semibold" title={e.title}>
                        {e.title}
                      </span>
                    </span>
                    {(e.actual || e.forecast) && (
                      <span className="font-mono text-[11px] text-dim">
                        {e.actual ? `${t.actual} ${e.actual} · ` : ''}
                        {t.forecast} {e.forecast ?? '—'}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function NewsPage() {
  const all = useT();
  const t = all.news;
  const language = useLanguage();
  const { data: me } = useMe();
  const { data: instruments } = useInstruments();
  const { fresh } = useNewsLive();
  useNewsScreen();
  const timezone = me?.settings.timezone ?? 'Europe/Warsaw';
  const keywords = me?.settings.newsKeywords ?? [];

  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Filters just reset on the next visit.
    }
  }, [filters]);

  const news = useNews({
    categories: filters.categories.length ? filters.categories : undefined,
    currencies: filters.currencies.length ? filters.currencies : undefined,
    instrumentId: filters.instrumentId || undefined,
    q: q || undefined,
    noise: filters.noise,
    important: filters.important,
  });
  const items = news.data?.pages.flatMap((p) => p.items) ?? [];
  const feed = news.data?.pages[0]?.feed;
  const filtered =
    filters.categories.length > 0 || filters.currencies.length > 0 || Boolean(filters.instrumentId) || Boolean(q) || filters.important;

  const toggle = <K extends 'categories' | 'currencies'>(key: K, value: Filters[K][number]) =>
    setFilters((f) => {
      const list = f[key] as string[];
      return { ...f, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  // Hour headers inside each day, so a long feed reads like a timeline.
  const hourOf = (iso: string) => timeOf(iso, timezone).slice(0, 2);

  return (
    <main className="page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <FeedStatus feed={feed} />
        {news.isFetching && !news.isFetchingNextPage && <span className="font-mono text-xs text-dim">…</span>}
      </div>

      <section aria-label={t.filters} className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <div className="w-full sm:w-60">
          <Input type="search" aria-label={t.search} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchPlaceholder} className="h-9" />
        </div>
        <Chip active={filters.important} onClick={() => setFilters((f) => ({ ...f, important: !f.important }))}>
          <span className="size-2 rounded-full bg-breaking" aria-hidden />
          {t.importantOnly}
        </Chip>
        <span aria-hidden className="hidden w-px self-stretch bg-line sm:block" />
        <div role="group" aria-label={t.category} className="flex flex-wrap gap-1.5">
          <Chip active={filters.categories.length === 0} onClick={() => setFilters((f) => ({ ...f, categories: [] }))}>
            {all.common.all}
          </Chip>
          {NEWS_CATEGORIES.map((c) => (
            <Chip key={c} active={filters.categories.includes(c)} onClick={() => toggle('categories', c)}>
              {NEWS_CATEGORY_LABELS[language][c]}
            </Chip>
          ))}
        </div>
        <span aria-hidden className="hidden w-px self-stretch bg-line sm:block" />
        <div role="group" aria-label={t.currency} className="flex flex-wrap gap-1.5">
          {NEWS_CURRENCIES.map((c) => (
            <Chip key={c} active={filters.currencies.includes(c)} onClick={() => toggle('currencies', c)}>
              <CurrencyFlag currency={c} size={16} />
              {c}
            </Chip>
          ))}
        </div>
        <div className="grow" />
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <div className="min-w-0 grow sm:w-56 sm:grow-0">
            <Select
              aria-label={t.instrument}
              value={filters.instrumentId}
              onChange={(instrumentId) => setFilters((f) => ({ ...f, instrumentId }))}
              options={[
                { value: '', label: `${t.instrument}: ${all.common.all.toLowerCase()}` },
                ...instrumentOptions(instruments ?? [], { label: (i) => i.symbol, favorites: all.instruments.favorites, others: all.instruments.others }),
              ]}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-dim">
            <input type="checkbox" checked={filters.noise} onChange={(e) => setFilters((f) => ({ ...f, noise: e.target.checked }))} className="accent-(--accent)" />
            {t.showNoise}
          </label>
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label={t.feed} className="card min-w-0 overflow-hidden">
          {items.length === 0 ? (
            <p className="m-0 px-5 py-10 text-center text-sm text-dim">
              {news.isPending ? all.common.loading : filtered || filters.noise ? t.empty : t.emptyFeed}
            </p>
          ) : (
            <ul className="m-0 list-none py-1">
              {items.map((item, i) => {
                const day = toLocalDate(new Date(item.publishedAt), timezone);
                const previous = items[i - 1];
                const prevDay = previous ? toLocalDate(new Date(previous.publishedAt), timezone) : null;
                const newHour = day !== prevDay || !previous || hourOf(previous.publishedAt) !== hourOf(item.publishedAt);
                return (
                  <Fragment key={item.id}>
                    {day !== prevDay && (
                      <li className="px-5 pt-3 pb-1 text-[13px] font-bold">
                        <span className="inline-block first-letter:uppercase">{longDate(day)}</span>
                      </li>
                    )}
                    {newHour && (
                      <li aria-hidden className="flex items-center gap-2.5 px-5 pt-2 pb-1 font-mono text-[11px] font-bold text-dim">
                        {hourOf(item.publishedAt)}:00
                        <span className="h-px grow bg-line" />
                      </li>
                    )}
                    <Headline item={item} keywords={keywords} timezone={timezone} fresh={fresh.has(item.id)} />
                  </Fragment>
                );
              })}
            </ul>
          )}
          {news.hasNextPage && (
            <div className="flex justify-center border-t border-line p-3">
              <Button size="sm" variant="ghost" onClick={() => void news.fetchNextPage()} disabled={news.isFetchingNextPage}>
                {news.isFetchingNextPage ? t.loadingMore : t.more}
              </Button>
            </div>
          )}
        </section>

        {/* Rides along with the feed on wide screens. */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <Upcoming timezone={timezone} />
          <KeywordAlerts keywords={keywords} />
        </div>
      </div>

      <p className="m-0 text-xs text-dim">{t.source}</p>
    </main>
  );
}
