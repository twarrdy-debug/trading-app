import { AUTO_FX_CURRENCIES, setSpreadSchema, spreadParams } from '@trading/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { dailySpreads, instruments } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { getFxRate } from '../services/fx.ts';

const tags = ['spready i kursy'];

export const spreadRoutes: FastifyPluginAsyncZod = async (app) => {
  const loadInstrument = async (id: string) => {
    const [row] = await app.db.select({ id: instruments.id, market: instruments.market }).from(instruments).where(eq(instruments.id, id));
    if (!row) throw badRequest('Nieznany instrument');
    return row;
  };

  /**
   * Spread for an instrument on a day. When `spread` is null and `askUser` is true, the client
   * should ask for it before the first trade of the day, pre-filled with `suggestion`.
   */
  app.get('/spreads/:instrumentId/:date', { schema: { tags, params: spreadParams } }, async (req) => {
    const { instrumentId, date } = req.params;
    const instrument = await loadInstrument(instrumentId);
    const mine = and(eq(dailySpreads.userId, req.user.id), eq(dailySpreads.instrumentId, instrumentId));
    const [[current], [previous]] = await Promise.all([
      app.db.select().from(dailySpreads).where(and(mine, eq(dailySpreads.date, date))),
      app.db.select().from(dailySpreads).where(and(mine, lt(dailySpreads.date, date))).orderBy(desc(dailySpreads.date)).limit(1),
    ]);
    const spread = current?.spreadUnits ?? null;
    return {
      instrumentId,
      date,
      spread,
      // Futures have no broker spread to track; CFD spreads change daily.
      askUser: instrument.market === 'cfd' && spread == null,
      suggestion: previous ? { spread: previous.spreadUnits, date: previous.date } : null,
    };
  });

  app.put(
    '/spreads/:instrumentId/:date',
    { schema: { tags, params: spreadParams, body: setSpreadSchema } },
    async (req) => {
      const { instrumentId, date } = req.params;
      await loadInstrument(instrumentId);
      const [row] = await app.db
        .insert(dailySpreads)
        .values({ userId: req.user.id, instrumentId, date, spreadUnits: req.body.spread })
        .onConflictDoUpdate({
          target: [dailySpreads.userId, dailySpreads.instrumentId, dailySpreads.date],
          set: { spreadUnits: req.body.spread },
        })
        .returning();
      return { instrumentId, date, spread: row!.spreadUnits };
    },
  );

  const currency = z.enum(AUTO_FX_CURRENCIES);
  app.get(
    '/fx-rate',
    { schema: { tags, querystring: z.object({ base: currency, quote: currency, date: z.iso.date().optional() }) } },
    async (req, reply) => {
      const date = req.query.date ?? new Date().toISOString().slice(0, 10);
      const rate = await getFxRate(app.db, app.fx, req.query.base, req.query.quote, date);
      if (!rate) return reply.status(503).send({ error: 'Kurs chwilowo niedostępny' });
      return { base: req.query.base, quote: req.query.quote, date, ...rate };
    },
  );
};
