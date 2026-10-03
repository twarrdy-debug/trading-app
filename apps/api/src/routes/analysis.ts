import {
  addChecklistItemSchema,
  checklistParams,
  createLevelSchema,
  DEFAULT_CHECKLIST_ITEMS,
  idParams,
  levelFiltersSchema,
  toLocalDate,
  updateChecklistItemSchema,
  updateChecklistSchema,
  updateLevelSchema,
} from '@trading/shared';
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
import { badRequest, notFound } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

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

export const analysisRoutes: FastifyPluginAsyncZod = async (app) => {
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
