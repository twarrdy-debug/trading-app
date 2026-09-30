import { eventTitleScore, GEOPOLITICS_ASSETS, NEWS_CURRENCIES, parseNewsTitle, sameReleaseValue, type NewsQuery } from '@trading/shared';
import { and, arrayContains, arrayOverlaps, desc, eq, gte, ilike, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { economicEvents, instrumentCurrencies, instruments, newsItems } from '../db/schema.ts';

/** One headline from the feed. */
export interface FeedItem {
  guid: string;
  title: string;
  link: string | null;
  publishedAt: Date;
  /** Marked red by FinancialJuice; null when the source can't tell (RSS). */
  important?: boolean | null;
  /** FinancialJuice's own tags, when known. */
  labels?: string[];
}

/** The feed refused or failed; `retryAfter` (seconds) when it asked us to slow down (429). */
export class FeedError extends Error {
  constructor(
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export interface NewsSource {
  /** The latest headlines, newest first. */
  fetchLatest(): Promise<FeedItem[]>;
}

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeXml(m[1]!).trim() : null;
};

/** Items of an RSS 2.0 document; ones without a guid, title or valid date are skipped. */
export function parseRss(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const guid = tag(body!, 'guid');
    const title = tag(body!, 'title');
    const publishedAt = new Date(tag(body!, 'pubDate') ?? '');
    if (!guid || !title || Number.isNaN(publishedAt.getTime())) continue;
    items.push({ guid, title, link: tag(body!, 'link')?.replace(/\?xy=rss$/, '') ?? null, publishedAt });
  }
  return items;
}

const USER_AGENT = 'Mozilla/5.0';

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': USER_AGENT, ...headers } });
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new FeedError(`FinancialJuice ${res.status}`, res.status === 429 ? (retryAfter > 0 ? retryAfter : 60) : null);
  }
  return res;
}

/** FinancialJuice's public RSS: the last 100 headlines (about 8 hours), without the red marking. */
export const financialJuiceRss: NewsSource = {
  async fetchLatest() {
    return parseRss(await (await get('https://www.financialjuice.com/feed.ashx?xy=rss')).text());
  },
};

/** One headline as the FinancialJuice site loads it (`FJService.asmx`). */
export interface FjApiNews {
  NewsID: number;
  Title: string;
  DatePublished: string;
  EURL?: string;
  Breaking?: boolean;
  /** CSS classes of the row: "active" (and "active-critical") paint it red. */
  Level?: string;
  Labels?: string[];
}

/**
 * Headlines from the site API. `DatePublished` has the right UTC time of day but not always the
 * right day (on 29.09.2026 `Startup` said 24.09), so the day is the latest one that is not in the
 * future; the list only holds the last few dozen headlines.
 */
export function parseFjApiNews(news: FjApiNews[], now = new Date()): FeedItem[] {
  return news.flatMap((n) => {
    const time = /T(\d{2}):(\d{2}):(\d{2})/.exec(n.DatePublished);
    if (!n.NewsID || !n.Title || !time) return [];
    const at = new Date(now);
    at.setUTCHours(Number(time[1]), Number(time[2]), Number(time[3]), 0);
    if (at.getTime() > now.getTime() + 5 * 60_000) at.setUTCDate(at.getUTCDate() - 1);
    return [
      {
        guid: String(n.NewsID),
        title: n.Title,
        link: n.EURL || null,
        publishedAt: at,
        important: Boolean(n.Breaking) || /\bactive\b/.test(n.Level ?? ''),
        labels: n.Labels ?? [],
      },
    ];
  });
}

/** The guest token the site embeds in every page (`var info = '…'`); it lasts at least hours. */
const TOKEN_TTL_MS = 6 * 3_600_000;
/** How far back the site source pages after a start, one page per poll. */
const BACKFILL_MS = 12 * 3_600_000;

/**
 * The FinancialJuice site API, as an anonymous visitor uses it: the latest headlines with the red
 * marking and FJ's tags. Undocumented, so any failure falls back to the RSS (no red marking) and
 * the token is fetched again next time. After a start it also pages back (one `GetPreviousNews`
 * page per poll, up to 12 hours), so headlines stored from the RSS get their marking.
 */
export function financialJuiceSiteSource(rss: NewsSource = financialJuiceRss): NewsSource & { lastMode: 'site' | 'rss' | null } {
  let token: { value: string; at: number } | null = null;

  const guestToken = async () => {
    if (token && Date.now() - token.at < TOKEN_TTL_MS) return token.value;
    const html = await (await get('https://www.financialjuice.com/home')).text();
    const value = /var info\s*=\s*'([^']+)'/.exec(html)?.[1];
    if (!value) throw new FeedError('FinancialJuice: no guest token');
    token = { value, at: Date.now() };
    return value;
  };

  const call = async (method: 'Startup' | 'GetPreviousNews', oldID: number) => {
    const params = new URLSearchParams({
      info: JSON.stringify(await guestToken()),
      TimeOffset: '0',
      tabID: '0',
      oldID: String(oldID),
      TickerID: '0',
      FeedCompanyID: '0',
      strSearch: '""',
      extraNID: '0',
    });
    // Without the JSON content type the service answers in XML.
    const res = await get(`https://live.financialjuice.com/FJService.asmx/${method}?${params}`, {
      'content-type': 'application/json; charset=utf-8',
      referer: 'https://www.financialjuice.com/',
    });
    return JSON.parse(((await res.json()) as { d: string }).d) as unknown;
  };

  /** The oldest headline paged back to so far; null once the backfill is done. */
  let backfillFrom: number | null | undefined;

  const source = {
    lastMode: null as 'site' | 'rss' | null,
    async fetchLatest() {
      let items: FeedItem[];
      try {
        const news = (await call('Startup', 0)) as { News?: FjApiNews[] };
        if (!Array.isArray(news.News) || news.News.length === 0) throw new Error('FinancialJuice: unexpected site response');
        items = parseFjApiNews(news.News);
        source.lastMode = 'site';
      } catch (err) {
        // A refused request is not retried against the RSS right away (same rate limit).
        if (err instanceof FeedError && err.retryAfter != null) throw err;
        token = null;
        source.lastMode = 'rss';
        return rss.fetchLatest();
      }

      if (backfillFrom === undefined) backfillFrom = Math.min(...items.map((i) => Number(i.guid)));
      if (backfillFrom) {
        // The backfill is extra: when it fails, the next poll tries the same page again.
        const older = await call('GetPreviousNews', backfillFrom).catch(() => null);
        if (Array.isArray(older)) {
          const page = parseFjApiNews(older as FjApiNews[]);
          const oldest = page.at(-1);
          backfillFrom = !oldest || Date.now() - oldest.publishedAt.getTime() > BACKFILL_MS ? null : Number(oldest.guid);
          items = [...items, ...page];
        }
      }
      return items;
    },
  };
  return source;
}

/**
 * FinancialJuice: unofficial for our purpose (fine for personal use); a licensed feed must replace
 * it before other users rely on it.
 */
export const financialJuiceSource = financialJuiceSiteSource();

const SOURCE = 'financialjuice';

type NewsRow = typeof newsItems.$inferSelect;
interface LinkedEvent {
  id: string;
  title: string;
  impact: (typeof economicEvents.$inferSelect)['impact'];
}

const toView = (row: NewsRow, event: LinkedEvent | null) => ({
  id: row.id,
  title: row.title,
  url: row.url,
  speaker: row.speaker,
  sourceName: row.sourceName,
  category: row.category,
  currencies: row.currencies,
  assets: row.assets,
  data: row.data,
  event: event && { id: event.id, title: event.title, impact: event.impact },
  noise: row.noise,
  important: row.important,
  publishedAt: row.publishedAt,
});

export type NewsView = ReturnType<typeof toView>;

// --- Live updates ------------------------------------------------------------------

type Listener = (items: NewsView[]) => void;

/** Fans new headlines out to open streams (`GET /news/stream`) and remembers the feed's health. */
export class NewsHub {
  private listeners = new Set<Listener>();
  /** Set when a scheduler polls the feed; without it the feed is off (NEWS_INTERVAL_SECONDS=0). */
  enabled = false;
  lastSuccessAt: Date | null = null;
  lastError: string | null = null;
  /** Where the last headlines came from: the site API (with red marking) or the RSS fallback. */
  mode: 'site' | 'rss' | null = null;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  publish(items: NewsView[]) {
    if (items.length === 0) return;
    for (const listener of this.listeners) listener(items);
  }

  get subscribers() {
    return this.listeners.size;
  }
}

// --- Import ----------------------------------------------------------------------------

/** A headline marked red later is pushed to open streams only while it is this fresh. */
const RECENT_MS = 15 * 60_000;

/** A release is published within minutes after its scheduled time. */
const MATCH_BEFORE_MS = 20 * 60_000;
const MATCH_AFTER_MS = 3 * 60_000;

/**
 * The calendar event a released value belongs to: same currency, scheduled shortly before the
 * headline, and a matching title (or a weaker title match with the same forecast).
 */
async function matchEvent(db: DB, row: NewsRow): Promise<LinkedEvent | null> {
  if (!row.data || row.currencies.length === 0) return null;
  const published = row.publishedAt.getTime();
  const candidates = await db
    .select({ id: economicEvents.id, title: economicEvents.title, impact: economicEvents.impact, forecast: economicEvents.forecast })
    .from(economicEvents)
    .where(
      and(
        inArray(economicEvents.currency, row.currencies),
        gte(economicEvents.eventTime, new Date(published - MATCH_BEFORE_MS)),
        lte(economicEvents.eventTime, new Date(published + MATCH_AFTER_MS)),
        ne(economicEvents.impact, 'holiday'),
      ),
    );
  let best: { event: LinkedEvent; score: number } | null = null;
  for (const c of candidates) {
    const titleScore = eventTitleScore(row.data.name, c.title);
    const score = titleScore + (titleScore > 0 && sameReleaseValue(row.data.forecast, c.forecast) ? 0.3 : 0);
    if (titleScore >= 0.6 || (titleScore >= 0.34 && score >= 0.64)) {
      if (!best || score > best.score) best = { event: { id: c.id, title: c.title, impact: c.impact }, score };
    }
  }
  return best?.event ?? null;
}

/**
 * Stores headlines not seen before and returns them (newest first), plus known ones that the site
 * API has since marked red (stored earlier from the RSS). Released values are matched to calendar
 * events, whose `actual` is filled in (the Forex Factory feed has none).
 */
export async function importNews(db: DB, feed: FeedItem[], now = new Date()): Promise<NewsView[]> {
  const fresh: NewsView[] = [];
  // Oldest first, so a later revision ("… Rev.") never overwrites the first actual.
  for (const item of [...feed].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) {
    const parsed = parseNewsTitle(item.title);
    // FJ's own currency tags catch what the title rules miss.
    const fromLabels = (item.labels ?? []).filter((l) => NEWS_CURRENCIES.includes(l) && !parsed.currencies.includes(l));
    const [row] = await db
      .insert(newsItems)
      .values({
        source: SOURCE,
        externalId: item.guid,
        title: parsed.title,
        url: item.link,
        speaker: parsed.speaker,
        sourceName: parsed.sourceName,
        category: parsed.category,
        currencies: [...parsed.currencies, ...fromLabels],
        assets: parsed.assets,
        data: parsed.data,
        noise: parsed.noise,
        important: item.important ?? false,
        labels: item.labels ?? [],
        publishedAt: item.publishedAt,
        fetchedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      if (item.important == null) continue;
      // Stored before from the RSS: take over the site's marking and tags (the time stays).
      const [changed] = await db
        .update(newsItems)
        .set({ important: item.important, labels: item.labels ?? [] })
        .where(and(eq(newsItems.source, SOURCE), eq(newsItems.externalId, item.guid), ne(newsItems.important, item.important)))
        .returning();
      // Only recent ones are pushed (and alert); old ones just change colour in the list.
      if (changed?.important && now.getTime() - changed.publishedAt.getTime() < RECENT_MS) fresh.push(toView(changed, null));
      continue;
    }

    const event = await matchEvent(db, row);
    if (event && row.data) {
      await db.update(newsItems).set({ eventId: event.id }).where(eq(newsItems.id, row.id));
      await db
        .update(economicEvents)
        .set({ actual: row.data.actual })
        .where(and(eq(economicEvents.id, event.id), isNull(economicEvents.actual)));
    }
    fresh.push(toView({ ...row, eventId: event?.id ?? null }, event));
  }
  return fresh.reverse();
}

/** Fetches the feed once, stores what is new and pushes it to open streams. */
export async function refreshNews(db: DB, source: NewsSource, hub: NewsHub) {
  try {
    const fresh = await importNews(db, await source.fetchLatest());
    hub.lastSuccessAt = new Date();
    hub.lastError = null;
    if ('lastMode' in source) hub.mode = (source as { lastMode: 'site' | 'rss' | null }).lastMode;
    hub.publish(fresh);
    return { status: 'updated' as const, added: fresh.length };
  } catch (err) {
    hub.lastError = (err as Error).message;
    return { status: 'error' as const, message: hub.lastError, retryAfter: err instanceof FeedError ? err.retryAfter : null };
  }
}

/** Longest wait between polls while the feed keeps failing or throttling us. */
const MAX_BACKOFF_S = 600;

/**
 * Polls the feed every `seconds`. After an error or a 429 the wait doubles (at least what the
 * feed's Retry-After asks, at most 10 minutes) and returns to `seconds` after the next success.
 * Logs only changes between working and failing. The first poll can use `backfill` (the RSS holds
 * 8 hours, the site API only the latest few dozen), to fill the gap since the server last ran.
 */
export function startNewsScheduler(
  db: DB,
  source: NewsSource,
  hub: NewsHub,
  seconds: number,
  log: (msg: string) => void,
  backfill?: NewsSource,
) {
  hub.enabled = true;
  let stopped = false;
  let timer: NodeJS.Timeout;
  let wait = seconds;
  let failing: boolean | null = null;

  let first = Boolean(backfill);
  const run = async () => {
    const result = await refreshNews(db, first && backfill ? backfill : source, hub);
    first = false;
    if (stopped) return;
    if (result.status === 'error') {
      wait = Math.min(MAX_BACKOFF_S, Math.max(wait * 2, result.retryAfter ?? 0));
    } else {
      wait = seconds;
    }
    const nowFailing = result.status === 'error';
    if (nowFailing !== failing) {
      log(nowFailing ? `News FinancialJuice: błąd (${hub.lastError}), ponowienie za ${wait} s` : 'News FinancialJuice: działa');
      failing = nowFailing;
    }
    timer = setTimeout(() => void run(), wait * 1_000);
  };
  timer = setTimeout(() => void run(), 5_000);
  return () => {
    stopped = true;
    hub.enabled = false;
    clearTimeout(timer);
  };
}

// --- Reading ---------------------------------------------------------------------------

/** "2026-09-29T09:22:56.000Z_<uuid>": the last headline of a page. */
const encodeCursor = (row: NewsRow) => `${row.publishedAt.toISOString()}_${row.id}`;

function decodeCursor(cursor: string) {
  const [time, id] = cursor.split('_');
  const date = new Date(time ?? '');
  return Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id) ? null : { date, id };
}

/** A health check is late when two polls in a row were missed. */
const STALE_MS = 3 * 60_000;

export async function listNews(db: DB, hub: NewsHub, q: NewsQuery) {
  let instrumentFilter;
  if (q.instrumentId) {
    const [instrument] = await db.select({ assetClass: instruments.assetClass }).from(instruments).where(eq(instruments.id, q.instrumentId));
    const currencies = (
      await db.select({ currency: instrumentCurrencies.currency }).from(instrumentCurrencies).where(eq(instrumentCurrencies.instrumentId, q.instrumentId))
    ).map((c) => c.currency);
    // Forex pairs are covered by their currencies; gold, oil and indices also by market headlines.
    const conditions = [
      currencies.length ? arrayOverlaps(newsItems.currencies, currencies) : undefined,
      instrument && instrument.assetClass !== 'forex' && instrument.assetClass !== 'other'
        ? arrayContains(newsItems.assets, [instrument.assetClass])
        : undefined,
      // Gold also reacts to geopolitics (newsAffectsInstrument() in shared/news.ts).
      instrument && GEOPOLITICS_ASSETS.includes(instrument.assetClass) ? eq(newsItems.category, 'geopolitics') : undefined,
    ].filter((c) => c !== undefined);
    // An unknown instrument or one with nothing to match returns no headlines.
    instrumentFilter = conditions.length ? or(...conditions) : sql`false`;
  }
  const cursor = q.before ? decodeCursor(q.before) : null;

  const rows = await db
    .select({ news: newsItems, event: { id: economicEvents.id, title: economicEvents.title, impact: economicEvents.impact } })
    .from(newsItems)
    .leftJoin(economicEvents, eq(economicEvents.id, newsItems.eventId))
    .where(
      and(
        q.noise ? undefined : eq(newsItems.noise, false),
        q.important ? eq(newsItems.important, true) : undefined,
        q.categories?.length ? inArray(newsItems.category, q.categories) : undefined,
        q.currencies?.length ? arrayOverlaps(newsItems.currencies, q.currencies) : undefined,
        instrumentFilter,
        q.q ? ilike(newsItems.title, `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
        cursor
          ? or(lt(newsItems.publishedAt, cursor.date), and(eq(newsItems.publishedAt, cursor.date), lt(newsItems.id, cursor.id)))
          : undefined,
      ),
    )
    .orderBy(desc(newsItems.publishedAt), desc(newsItems.id))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => toView(r.news, r.event?.id ? (r.event as LinkedEvent) : null)),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.news) : null,
    feed: {
      enabled: hub.enabled,
      live: hub.enabled && hub.lastSuccessAt != null && Date.now() - hub.lastSuccessAt.getTime() < STALE_MS,
      lastSuccessAt: hub.lastSuccessAt,
      error: hub.lastError,
      mode: hub.mode,
    },
  };
}
