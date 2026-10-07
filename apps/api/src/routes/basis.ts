import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { t } from '../i18n.ts';
import { basisOverview, measureAll } from '../services/basis.ts';

const tags = ['kalkulator'];

export const basisRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Latest measured futures − CFD difference per pair, with history and alerts. */
  app.get('/basis', { schema: { tags } }, () => basisOverview(app.db));

  /** Measures all pairs now instead of waiting for the scheduler. */
  app.post('/basis/refresh', { schema: { tags }, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req) => {
    const results = await measureAll(app.db, app.quotes);
    const message = (r: (typeof results)[number]) =>
      r.status === 'saved'
        ? null
        : r.status === 'unchanged'
          ? t(req.user.language, 'basisUnchanged')
          : t(req.user.language, 'basisFailed', { reason: r.message });
    return {
      results: results.map((r) => ({ pairKey: r.pairKey, status: r.status, message: message(r) })),
      overview: await basisOverview(app.db),
    };
  });
};
