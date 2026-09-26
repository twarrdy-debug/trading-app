import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { basisOverview, measureAll } from '../services/basis.ts';

const tags = ['kalkulator'];

export const basisRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Latest measured futures − CFD difference per pair, with history and alerts. */
  app.get('/basis', { schema: { tags } }, () => basisOverview(app.db));

  /** Measures all pairs now instead of waiting for the scheduler. */
  app.post('/basis/refresh', { schema: { tags } }, async () => {
    const results = await measureAll(app.db, app.quotes);
    return {
      results: results.map((r) => ({ pairKey: r.pairKey, status: r.status, message: 'message' in r ? r.message : null })),
      overview: await basisOverview(app.db),
    };
  });
};
