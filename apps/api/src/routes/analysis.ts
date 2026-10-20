import {
  addChecklistItemSchema,
  analysisSource,
  checklistParams,
  createLevelSchema,
  DEFAULT_CHECKLIST_ITEMS,
  idParams,
  levelFiltersSchema,
  marketAnalysisQuerySchema,
  toLocalDate,
  updateChecklistItemSchema,
  updateChecklistSchema,
  updateLevelSchema,
} from '@trading/shared';
import type { ServerResponse } from 'node:http';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  checklistItems,
  economicEvents,
  instrumentCurrencies,
  instruments,
  liquidityLevels,
  sessionChecklists,
} from '../db/schema.ts';
import type { DB } from '../db/client.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { analysisOverview, basisOffset, marketAnalysis } from '../services/market-analysis.ts';

const HIGHER_TIMEFRAMES = ['H4', 'D1', 'W1', 'MN'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const validOn = (date: string) =>
  and(lte(liquidityLevels.validFrom, date), or(isNull(liquidityLevels.validUntil), gte(liquidityLevels.validUntil, date)));

/** Economic events on the user's local calendar day for the instrument's currencies. */
async function eventsForDay(db: DB, user: CurrentUser, instrumentId: string, date: string) {
  const currencies = db
    .select({ currency: instrumentCurrencies.currency })
    .from(instrumentCurrencies)
    .where(eq(instrumentCurrencies.instrumentId, instrumentId));
  // Query a wider UTC window, then keep events whose local date matches.
  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const rows = await db
    .select()
    .from(economicEvents)
    .where(
      and(
        inArray(economicEvents.currency, currencies),
        gte(economicEvents.eventTime, new Date(dayStart - DAY_MS)),
        lte(economicEvents.eventTime, new Date(dayStart + 2 * DAY_MS)),
      ),
    )
    .orderBy(asc(economicEvents.eventTime));
  return rows.filter((e) => toLocalDate(e.eventTime, user.timezone) === date);
}

/** Keeps proxies and tunnels from closing an idle stream. */
const LIVE_PING_MS = 25_000;
/** A futures chart's shift is read again this often while it is open. */
const OFFSET_MS = 60_000;
/** Open live charts per user (one per tab). */
const MAX_LIVE_PER_USER = 6;

export const analysisRoutes: FastifyPluginAsyncZod = async (app) => {
  const liveStreams = new Map<string, number>();
  const liveResponses = new Set<ServerResponse>();
  // Open streams would keep the server from closing.
  app.addHook('onClose', async () => {
    for (const res of liveResponses) res.end();
  });

  /**
   * The instrument's live price as server-sent events (`event: price`, `{ time, price }`), the bid
   * like the candles; futures get their CFD's price shifted by the latest measured difference.
   */
  app.get('/analysis/live/:id', { schema: { tags: ['analiza'], params: idParams } }, async (req, reply) => {
    const live = app.live;
    if (!live) throw badRequest('liveUnavailable');
    const [instrument] = await app.db.select().from(instruments).where(eq(instruments.id, req.params.id));
    if (!instrument) throw notFound('unknownInstrument');
    const source = analysisSource(instrument.symbol);
    if (!source) throw badRequest('analysisUnavailable', { symbol: instrument.symbol });
    const userId = req.user.id;
    const open = liveStreams.get(userId) ?? 0;
    if (open >= MAX_LIVE_PER_USER) throw new HttpError(429, 'tooManyStreams');
    liveStreams.set(userId, open + 1);

    let shift = source.via ? ((await basisOffset(app.db, instrument.symbol))?.difference ?? 0) : 0;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    liveResponses.add(res);
    const unsubscribe = live.subscribe(source.epic, (q) => {
      const price = Math.round((q.price + shift) * 1e6) / 1e6;
      res.write(`event: price\ndata: ${JSON.stringify({ time: q.time.toISOString(), price })}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), LIVE_PING_MS);
    const offset = source.via
      ? setInterval(() => {
          void basisOffset(app.db, instrument.symbol).then((o) => {
            if (o) shift = o.difference;
          });
        }, OFFSET_MS)
      : null;
    const end = () => {
      unsubscribe();
      clearInterval(ping);
      if (offset) clearInterval(offset);
      liveResponses.delete(res);
      const left = (liveStreams.get(userId) ?? 1) - 1;
      if (left > 0) liveStreams.set(userId, left);
      else liveStreams.delete(userId);
    };
    req.raw.on('close', end);
  });

  /**
   * Automatic analysis of one instrument from market data: candles, swings, equal highs and lows,
   * the previous day's and week's levels, ATR and client sentiment. Not investment advice.
   */
  app.get(
    '/analysis/market/:id',
    { schema: { tags: ['analiza'], params: idParams, querystring: marketAnalysisQuerySchema }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    (req) => marketAnalysis(app.db, app.market, req.params.id, req.query.resolution),
  );

  /** One line per favourite instrument (or every instrument with data): price, nearest equal levels, sentiment. */
  app.get('/analysis/overview', { schema: { tags: ['analiza'] }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, (req) =>
    analysisOverview(app.db, app.market, req.user),
  );

  const assertInstrument = async (id: string) => {
    const [row] = await app.db.select({ id: instruments.id }).from(instruments).where(eq(instruments.id, id));
    if (!row) throw badRequest('unknownInstrument');
  };

  // --- Liquidity levels --------------------------------------------------------

  app.get('/levels', { schema: { tags: ['analiza'], querystring: levelFiltersSchema } }, async (req) => {
    const { instrumentId, timeframe } = req.query;
    const date = req.query.date ?? toLocalDate(new Date(), req.user.timezone);
    return app.db
      .select()
      .from(liquidityLevels)
      .where(
        and(
          eq(liquidityLevels.userId, req.user.id),
          eq(liquidityLevels.instrumentId, instrumentId),
          validOn(date),
          timeframe ? eq(liquidityLevels.timeframe, timeframe) : undefined,
        ),
      )
      .orderBy(asc(liquidityLevels.price));
  });

  app.post('/levels', { schema: { tags: ['analiza'], body: createLevelSchema } }, async (req, reply) => {
    await assertInstrument(req.body.instrumentId);
    const [row] = await app.db
      .insert(liquidityLevels)
      .values({
        ...req.body,
        userId: req.user.id,
        validFrom: req.body.validFrom ?? toLocalDate(new Date(), req.user.timezone),
      })
      .returning();
    return reply.status(201).send(row);
  });

  app.patch('/levels/:id', { schema: { tags: ['analiza'], params: idParams, body: updateLevelSchema } }, async (req) => {
    const [row] = await app.db
      .update(liquidityLevels)
      .set(req.body)
      .where(and(eq(liquidityLevels.id, req.params.id), eq(liquidityLevels.userId, req.user.id)))
      .returning();
    if (!row) throw notFound('levelNotFound');
    return row;
  });

  app.delete('/levels/:id', { schema: { tags: ['analiza'], params: idParams } }, async (req, reply) => {
    const [row] = await app.db
      .delete(liquidityLevels)
      .where(and(eq(liquidityLevels.id, req.params.id), eq(liquidityLevels.userId, req.user.id)))
      .returning({ id: liquidityLevels.id });
    if (!row) throw notFound('levelNotFound');
    return reply.status(204).send();
  });

  // --- Pre-session checklist (one per instrument per day) ----------------------

  const loadChecklist = async (user: CurrentUser, instrumentId: string, date: string) => {
    await assertInstrument(instrumentId);
    const match = and(
      eq(sessionChecklists.userId, user.id),
      eq(sessionChecklists.instrumentId, instrumentId),
      eq(sessionChecklists.date, date),
    );
    let [checklist] = await app.db.select().from(sessionChecklists).where(match);
    if (!checklist) {
      await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(sessionChecklists)
          .values({ userId: user.id, instrumentId, date })
          .onConflictDoNothing()
          .returning();
        if (created) {
          await tx
            .insert(checklistItems)
            .values(DEFAULT_CHECKLIST_ITEMS[user.language].map((label, i) => ({ checklistId: created.id, label, sortOrder: i })));
        }
      });
      [checklist] = await app.db.select().from(sessionChecklists).where(match);
    }

    const [items, htfLevels, events] = await Promise.all([
      app.db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklist!.id))
        .orderBy(asc(checklistItems.sortOrder)),
      app.db
        .select()
        .from(liquidityLevels)
        .where(
          and(
            eq(liquidityLevels.userId, user.id),
            eq(liquidityLevels.instrumentId, instrumentId),
            inArray(liquidityLevels.timeframe, [...HIGHER_TIMEFRAMES]),
            validOn(date),
          ),
        )
        .orderBy(asc(liquidityLevels.price)),
      eventsForDay(app.db, user, instrumentId, date),
    ]);
    return { ...checklist!, items, htfLevels, events };
  };

  const ownedItem = (user: CurrentUser, itemId: string) =>
    and(
      eq(checklistItems.id, itemId),
      inArray(
        checklistItems.checklistId,
        app.db.select({ id: sessionChecklists.id }).from(sessionChecklists).where(eq(sessionChecklists.userId, user.id)),
      ),
    );

  const checklistPath = '/checklists/:instrumentId/:date';

  app.get(checklistPath, { schema: { tags: ['analiza'], params: checklistParams } }, (req) =>
    loadChecklist(req.user, req.params.instrumentId, req.params.date),
  );

  app.patch(
    checklistPath,
    { schema: { tags: ['analiza'], params: checklistParams, body: updateChecklistSchema } },
    async (req) => {
      const { id } = await loadChecklist(req.user, req.params.instrumentId, req.params.date);
      await app.db.update(sessionChecklists).set(req.body).where(eq(sessionChecklists.id, id));
      return loadChecklist(req.user, req.params.instrumentId, req.params.date);
    },
  );

  app.post(
    `${checklistPath}/items`,
    { schema: { tags: ['analiza'], params: checklistParams, body: addChecklistItemSchema } },
    async (req, reply) => {
      const checklist = await loadChecklist(req.user, req.params.instrumentId, req.params.date);
      const sortOrder = Math.max(-1, ...checklist.items.map((i) => i.sortOrder)) + 1;
      await app.db.insert(checklistItems).values({ checklistId: checklist.id, label: req.body.label, sortOrder });
      return reply.status(201).send(await loadChecklist(req.user, req.params.instrumentId, req.params.date));
    },
  );

  app.patch(
    '/checklist-items/:id',
    { schema: { tags: ['analiza'], params: idParams, body: updateChecklistItemSchema } },
    async (req) => {
      const [row] = await app.db.update(checklistItems).set(req.body).where(ownedItem(req.user, req.params.id)).returning();
      if (!row) throw notFound('checklistItemNotFound');
      return row;
    },
  );

  app.delete('/checklist-items/:id', { schema: { tags: ['analiza'], params: idParams } }, async (req, reply) => {
    const [row] = await app.db.delete(checklistItems).where(ownedItem(req.user, req.params.id)).returning({ id: checklistItems.id });
    if (!row) throw notFound('checklistItemNotFound');
    return reply.status(204).send();
  });
};
