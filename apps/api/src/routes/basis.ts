import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { t } from '../i18n.ts';
import { proCandlesQuerySchema, type ProResolution } from '@trading/shared';
import { basisOverview, measureAll } from '../services/basis.ts';
import { proCandles } from '../services/calculator-pro.ts';

const tags = ['kalkulator'];

export const basisRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Latest measured futures − CFD difference per pair, with history and alerts. */
  app.get('/basis', { schema: { tags } }, () => basisOverview(app.db));

  /** Calculator PRO: the pair's CFD and futures candles, to read a level from the same candle on both markets. */
  app.get(
    '/basis/pro',
    { schema: { tags, querystring: proCandlesQuerySchema }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    (req) => proCandles(app.db, app.market, app.quotes, req.query.pair, req.query.resolution as ProResolution),
  );

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
