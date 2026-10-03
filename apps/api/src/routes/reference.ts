import { createEducatorSchema, createInstrumentSchema, emotionLabel } from '@trading/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { emotions, instrumentCurrencies, instruments, users } from '../db/schema.ts';
import { HttpError } from '../errors.ts';
import { requireRole } from '../plugins/current-user.ts';

export const referenceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/instruments', { schema: { tags: ['słowniki'] } }, async () => {
    const rows = await app.db.query.instruments.findMany({
      where: (i, { eq }) => eq(i.active, true),
      with: { currencies: { columns: { currency: true } } },
      orderBy: (i) => asc(i.symbol),
    });
    return rows.map(({ currencies, ...i }) => ({ ...i, currencies: currencies.map((c) => c.currency) }));
  });

  app.post('/instruments', { schema: { tags: ['słowniki'], body: createInstrumentSchema } }, async (req, reply) => {
    requireRole(req, 'admin');
    const { currencies, ...values } = req.body;
    const created = await app.db.transaction(async (tx) => {
      const [row] = await tx.insert(instruments).values(values).onConflictDoNothing().returning();
      if (!row) throw new HttpError(409, 'instrumentExists', { symbol: values.symbol });
      if (currencies.length > 0) {
        await tx.insert(instrumentCurrencies).values(currencies.map((currency) => ({ instrumentId: row.id, currency })));
      }
      return { ...row, currencies };
    });
    return reply.status(201).send(created);
  });

  app.get('/emotions', { schema: { tags: ['słowniki'] } }, async (req) => {
    const rows = await app.db.select({ key: emotions.key, label: emotions.label }).from(emotions).orderBy(asc(emotions.sortOrder));
    return rows.map((e) => ({ key: e.key, label: req.user.language === 'pl' ? e.label : emotionLabel(req.user.language, e.key) }));
  });

  app.get('/educators', { schema: { tags: ['słowniki'] } }, async () =>
    app.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.role, 'educator'))
      .orderBy(asc(users.displayName)),
  );

  app.post('/educators', { schema: { tags: ['słowniki'], body: createEducatorSchema } }, async (req, reply) => {
    requireRole(req, 'admin');
    const [row] = await app.db
      .insert(users)
      .values({ displayName: req.body.displayName, email: req.body.email, role: 'educator' })
      .onConflictDoNothing()
      .returning({ id: users.id, displayName: users.displayName });
    if (!row) throw new HttpError(409, 'emailExists');
    return reply.status(201).send(row);
  });
};
