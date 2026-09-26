import {
  createSignalSchema,
  idParams,
  normalizeSymbol,
  parseSignal,
  parseSignalSchema,
  signalFiltersSchema,
  updateSignalSchema,
  validatePriceSides,
} from '@trading/shared';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { instruments, signals, signalTakeProfits, users } from '../db/schema.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import { requireRole } from '../plugins/current-user.ts';

const tags = ['sygnały'];

export const signalRoutes: FastifyPluginAsyncZod = async (app) => {
  const getSignal = async (id: string) => {
    const signal = await app.db.query.signals.findFirst({
      where: (s, { eq }) => eq(s.id, id),
      with: {
        takeProfits: { orderBy: (tp, { asc }) => asc(tp.level) },
        educator: { columns: { id: true, displayName: true } },
        instrument: { columns: { id: true, symbol: true, measureUnit: true } },
      },
    });
    if (!signal) throw notFound('Nie znaleziono sygnału');
    return signal;
  };

  app.get('/signals', { schema: { tags, querystring: signalFiltersSchema } }, async (req) => {
    const { instrumentId, educatorId, status, limit } = req.query;
    const conditions = [
      instrumentId && eq(signals.instrumentId, instrumentId),
      educatorId && eq(signals.educatorId, educatorId),
      status && eq(signals.status, status),
    ].filter((c): c is SQL => Boolean(c));
    return app.db.query.signals.findMany({
      where: and(...conditions),
      with: {
        takeProfits: { orderBy: (tp, { asc }) => asc(tp.level) },
        educator: { columns: { id: true, displayName: true } },
        instrument: { columns: { id: true, symbol: true, measureUnit: true } },
      },
      orderBy: desc(signals.publishedAt),
      limit,
    });
  });

  app.get('/signals/:id', { schema: { tags, params: idParams } }, (req) => getSignal(req.params.id));

  /** Turns a pasted message ("XAUUSD - SELL / IN: … / SL: … / TP1: …") into form values. */
  app.post('/signals/parse', { schema: { tags, body: parseSignalSchema } }, async (req) => {
    const result = parseSignal(req.body.text);
    if (!result.ok) return result;
    // Match "NQ1!", "NAS100" etc. to the stored symbol.
    const symbol = normalizeSymbol(result.signal.symbol);
    const [instrument] = await app.db
      .select({ id: instruments.id, symbol: instruments.symbol })
      .from(instruments)
      .where(eq(instruments.symbol, symbol));
    return {
      ...result,
      signal: { ...result.signal, symbol },
      instrument: instrument ?? null,
      warnings: instrument ? result.warnings : [...result.warnings, `Instrument ${symbol} nie jest dodany w aplikacji`],
    };
  });

  app.post('/signals', { schema: { tags, body: createSignalSchema } }, async (req, reply) => {
    requireRole(req, 'educator', 'admin');
    const { takeProfits, educatorId: requestedEducator, publishedAt, ...values } = req.body;

    const educatorId = req.user.role === 'admin' ? (requestedEducator ?? req.user.id) : req.user.id;
    if (educatorId !== req.user.id) {
      const [educator] = await app.db.select({ role: users.role }).from(users).where(eq(users.id, educatorId));
      if (educator?.role !== 'educator') throw badRequest('Nieznany edukator');
    }
    const [instrument] = await app.db.select({ id: instruments.id }).from(instruments).where(eq(instruments.id, values.instrumentId));
    if (!instrument) throw badRequest('Nieznany instrument');

    // A signal goes out to many traders, so prices on the wrong side are rejected, not just flagged.
    const problems = validatePriceSides(values.direction, values.entryPrice, values.stopLoss, takeProfits);
    if (problems.length > 0) throw badRequest('Sprawdź ceny sygnału', problems);

    const id = await app.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(signals)
        .values({ ...values, educatorId, publishedAt: publishedAt ? new Date(publishedAt) : undefined })
        .returning({ id: signals.id });
      await tx.insert(signalTakeProfits).values(takeProfits.map((price, i) => ({ signalId: row!.id, level: i + 1, price })));
      return row!.id;
    });
    // Later stage: notify subscribed users (push/e-mail) here.
    return reply.status(201).send(await getSignal(id));
  });

  app.patch('/signals/:id', { schema: { tags, params: idParams, body: updateSignalSchema } }, async (req) => {
    const signal = await getSignal(req.params.id);
    if (req.user.role !== 'admin' && signal.educatorId !== req.user.id) throw forbidden();
    await app.db.update(signals).set(req.body).where(eq(signals.id, signal.id));
    return getSignal(signal.id);
  });

  app.patch(
    '/signals/:id/take-profits/:level',
    {
      schema: {
        tags,
        params: idParams.extend({ level: z.coerce.number().int().min(1) }),
        body: z.object({ hit: z.boolean() }),
      },
    },
    async (req) => {
      const signal = await getSignal(req.params.id);
      if (req.user.role !== 'admin' && signal.educatorId !== req.user.id) throw forbidden();
      const [updated] = await app.db
        .update(signalTakeProfits)
        .set({ hitAt: req.body.hit ? new Date() : null })
        .where(and(eq(signalTakeProfits.signalId, signal.id), eq(signalTakeProfits.level, req.params.level)))
        .returning();
      if (!updated) throw notFound(`Sygnał nie ma TP${req.params.level}`);
      return getSignal(signal.id);
    },
  );
};
