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
import { Fragment, useEffect, useState, type KeyboardEvent } from 'react';
import { useCalendar, useInstruments, useMe, useNews, useUpdateSettings } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Chip, Field, Input } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { addDays, currentLocale } from '../../lib/format.ts';
import { loadAlertPrefs, saveAlertPrefs, useNewsLive, useNewsScreen, type AlertPrefs } from '../../lib/news-live.ts';
import { ACTUAL_COLOR, ImpactFlag } from '../calendar/CalendarPage.tsx';

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

function Tag({ children, accent = false, red = false }: { children: React.ReactNode; accent?: boolean; red?: boolean }) {
  const look = red ? (accent ? 'bg-accent text-on-accent' : 'bg-black/20 text-on-breaking') : accent ? 'bg-accent/20 text-ink' : 'bg-chip text-dim';
  return (
    <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${look}`}>
      {children}
    </span>
  );
}

/** On a red row the surprise colours would not read, so only the arrow tells. */
function Release({ data, event, red }: { data: NewsData; event: NewsItem['event']; red: boolean }) {
  const t = useT().news;
  const surprise = releaseSurprise(data);
  const mark = surprise === 'better' ? '▲' : surprise === 'worse' ? '▼' : surprise === 'inline' ? '=' : '';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {event && !red && (
        <span title={t.inCalendar(event.title)} className="flex">
          <ImpactFlag impact={event.impact} size={14} />
        </span>
      )}
      <span className="text-sm font-semibold">{data.name}</span>
      <span
        className={`font-mono text-[15px] font-medium ${red ? '' : ACTUAL_COLOR[surprise ?? 'inline']}`}
        title={surprise ? t[surprise] : undefined}
      >
        {mark && <span className="mr-1 text-[11px]">{mark}</span>}
        {data.actual}
      </span>
      <span className={`font-mono text-xs ${red ? 'text-on-breaking/80' : 'text-dim'}`}>
        {t.forecast} {data.forecast ?? '—'} · {t.previous} {data.previous ?? '—'}
        {data.revision && ` (${data.revision})`}
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
      className={`grid grid-cols-[48px_minmax(0,1fr)] gap-x-3 border-b border-line px-5 py-3 last:border-b-0 ${
        red
          ? `bg-breaking text-on-breaking ${hits.length ? 'shadow-[inset_4px_0_0_var(--accent)]' : ''}`
          : hits.length
            ? 'bg-accent/10 shadow-[inset_3px_0_0_var(--accent)]'
            : ''
      } ${fresh && !red ? 'news-fresh' : ''}`}
    >
      <time dateTime={item.publishedAt} className={`pt-0.5 font-mono text-xs ${dim}`}>
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
          {item.currencies.map((c) => (
            <Tag key={c} red={red}>
              {c}
            </Tag>
          ))}
          {hits.map((k) => (
            <Tag key={k} accent red={red}>
              {k}
            </Tag>
          ))}
          <span className={`text-[11px] ${dim}`}>
            {NEWS_CATEGORY_LABELS[language][item.category]}
            {item.sourceName && ` · ${item.sourceName}`}
          </span>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t.open}
              title={t.open}
              className={`ml-auto flex size-6 items-center justify-center rounded-md transition ${
                red ? 'text-on-breaking/80 hover:bg-black/20 hover:text-on-breaking' : 'text-dim hover:bg-chip hover:text-ink'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function FeedStatus({ feed }: { feed: NewsResponse['feed'] | undefined }) {
  const t = useT().news;
  const { connected } = useNewsLive();
  if (!feed) return null;
  const [dot, text] = !feed.enabled
    ? ['bg-dim', t.paused]
    : feed.error
      ? ['bg-sell', t.feedError(feed.error)]
      : connected && feed.live
        ? ['bg-buy animate-pulse', t.live]
        : ['bg-dim', t.connecting];
  return (
    <span className="flex items-center gap-2 text-xs text-dim">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      {text}
      {feed.mode === 'rss' && !feed.error && <span className="hidden sm:inline">· {t.rssMode}</span>}
    </span>
  );
}

function KeywordAlerts({ keywords }: { keywords: string[] }) {
  const t = useT().news;
  const update = useUpdateSettings();
  const [draft, setDraft] = useState('');
  const [prefs, setPrefs] = useState<AlertPrefs>(loadAlertPrefs);
  const [blocked, setBlocked] = useState(false);

  const save = (next: string[]) => update.mutate({ newsKeywords: next });
  const add = () => {
    const words = draft
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && !keywords.some((k) => k.toLowerCase() === w.toLowerCase()));
    if (words.length) save([...keywords, ...words].slice(0, 30));
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  const setPref = (patch: Partial<AlertPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveAlertPrefs(next);
  };
  const toggleNotify = async () => {
    if (prefs.notify) return setPref({ notify: false });
    if (typeof Notification === 'undefined') return setBlocked(true);
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setBlocked(permission !== 'granted');
    if (permission === 'granted') setPref({ notify: true });
  };

  return (
    <Panel title={t.alerts} as="aside" className="pb-5">
      <div className="flex flex-col gap-3 px-5">
        <p className="m-0 text-xs text-dim">{t.keywordsHelp}</p>
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span key={k} className="flex h-8 items-center gap-1 rounded-(--radius-chip) bg-accent/15 pr-1 pl-2.5 text-xs font-semibold">
                {k}
                <button
                  type="button"
                  onClick={() => save(keywords.filter((w) => w !== k))}
                  aria-label={t.removeKeyword(k)}
                  className="flex size-6 items-center justify-center rounded-md text-dim hover:bg-black/10 hover:text-ink"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder={t.keywordPlaceholder} maxLength={40} />
        <div className="flex flex-wrap gap-2">
          <Chip active={prefs.sound} onClick={() => setPref({ sound: !prefs.sound })}>
            {t.sound}
          </Chip>
          <Chip active={prefs.notify} onClick={() => void toggleNotify()}>
            {t.notifications}
          </Chip>
          <Chip active={prefs.red} onClick={() => setPref({ red: !prefs.red })}>
            <span className="size-2 rounded-full bg-breaking" aria-hidden />
            {t.redAlerts}
          </Chip>
        </div>
        {blocked && <p className="m-0 text-xs text-sell">{t.notificationsBlocked}</p>}
      </div>
    </Panel>
  );
}

function Upcoming({ timezone }: { timezone: string }) {
  const t = useT().news;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const today = toLocalDate(new Date(now), timezone);
  const { data } = useCalendar({ from: today, to: addDays(today, 1), impacts: ['high', 'medium'] });
  // Just released events stay a few minutes, so their actual shows up here too.
  const events = (data?.events ?? []).filter((e) => new Date(e.eventTime).getTime() > now - 10 * 60_000).slice(0, 6);

  return (
    <Panel title={t.upcoming} as="aside" className="pb-2">
      {events.length === 0 ? (
        <p className="m-0 px-5 pb-4 text-xs text-dim">{t.noUpcoming}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {events.map((e) => (
            <li key={e.id} className="grid grid-cols-[44px_36px_16px_minmax(0,1fr)] items-center gap-x-2 border-b border-line px-5 py-2.5 last:border-b-0">
              <span className="font-mono text-xs">{timeOf(e.eventTime, timezone)}</span>
              <span className="font-mono text-xs font-semibold">{e.currency}</span>
              <ImpactFlag impact={e.impact} size={14} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold" title={e.title}>
                  {e.title}
                </span>
                <span className="font-mono text-[11px] text-dim">
                  {e.actual ? `${t.actual} ${e.actual} · ` : ''}
                  {t.forecast} {e.forecast ?? '—'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
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

  return (
    <main className="flex grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title={t.feed}
          actions={
            <div className="flex items-center gap-3">
              {news.isFetching && !news.isFetchingNextPage && <span className="font-mono text-xs text-dim">…</span>}
              <FeedStatus feed={feed} />
            </div>
          }
          className="min-w-0 lg:order-none"
        >
          {items.length === 0 ? (
            <p className="m-0 px-5 py-10 text-center text-sm text-dim">
              {news.isPending ? all.common.loading : filtered || filters.noise ? t.empty : t.emptyFeed}
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {items.map((item, i) => {
                const day = toLocalDate(new Date(item.publishedAt), timezone);
                const prevDay = i > 0 ? toLocalDate(new Date(items[i - 1]!.publishedAt), timezone) : null;
                return (
                  <Fragment key={item.id}>
                    {day !== prevDay && (
                      <li className="border-b border-line bg-raised px-5 py-2 text-[13px] font-bold">
                        <span className="inline-block first-letter:uppercase">{longDate(day)}</span>
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
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title={t.filters} as="aside" className="pb-5">
            <div className="flex flex-col gap-4 px-5">
              <Field label={t.search}>
                <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchPlaceholder} />
              </Field>
              <div className="flex">
                <Chip active={filters.important} onClick={() => setFilters((f) => ({ ...f, important: !f.important }))}>
                  <span className="size-2 rounded-full bg-breaking" aria-hidden />
                  {t.importantOnly}
                </Chip>
              </div>
              <div className="flex flex-col gap-2">
                <span className="eyebrow">{t.category}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={filters.categories.length === 0} onClick={() => setFilters((f) => ({ ...f, categories: [] }))}>
                    {all.common.all}
                  </Chip>
                  {NEWS_CATEGORIES.map((c) => (
                    <Chip key={c} active={filters.categories.includes(c)} onClick={() => toggle('categories', c)}>
                      {NEWS_CATEGORY_LABELS[language][c]}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="eyebrow">{t.currency}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={filters.currencies.length === 0} onClick={() => setFilters((f) => ({ ...f, currencies: [] }))}>
                    {all.common.all}
                  </Chip>
                  {NEWS_CURRENCIES.map((c) => (
                    <Chip key={c} active={filters.currencies.includes(c)} onClick={() => toggle('currencies', c)}>
                      <span className="font-mono">{c}</span>
                    </Chip>
                  ))}
                </div>
              </div>
              <Field label={t.instrument}>
                <Select
                  value={filters.instrumentId}
                  onChange={(instrumentId) => setFilters((f) => ({ ...f, instrumentId }))}
                  options={[{ value: '', label: all.common.all }, ...(instruments ?? []).map((i) => ({ value: i.id, label: i.symbol }))]}
                />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-dim">
                <input type="checkbox" checked={filters.noise} onChange={(e) => setFilters((f) => ({ ...f, noise: e.target.checked }))} className="accent-(--accent)" />
                {t.showNoise}
              </label>
            </div>
          </Panel>
          <KeywordAlerts keywords={keywords} />
          <Upcoming timezone={timezone} />
        </div>
      </div>

      <p className="m-0 text-xs text-dim">{t.source}</p>
    </main>
  );
}
