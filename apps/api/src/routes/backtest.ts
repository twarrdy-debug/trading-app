import {
  backtestCandlesQuerySchema,
  createBacktestSessionSchema,
  idParams,
  openBacktestTradeSchema,
  updateBacktestSessionSchema,
  updateBacktestTradeSchema,
} from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  backtestCandles,
  createBacktestSession,
  deleteBacktestSession,
  deleteBacktestTrade,
  getBacktestSession,
  listBacktestSessions,
  openBacktestTrade,
  updateBacktestSession,
  updateBacktestTrade,
} from '../services/backtest.ts';

const tags = ['backtesting'];

/** Backtesting: replay sessions on backtest accounts, their simulated positions and the history they replay. */
export const backtestRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Past candles for a replay (Capital.com), in stretches of at most 1000. */
  app.get(
    '/backtest/candles',
    { schema: { tags, querystring: backtestCandlesQuerySchema }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    (req) => backtestCandles(app.db, app.market, req.query.instrumentId, req.query.resolution, new Date(req.query.from), new Date(req.query.to)),
  );

  app.get('/backtest/sessions', { schema: { tags } }, (req) => listBacktestSessions(app.db, req.user));

  app.post('/backtest/sessions', { schema: { tags, body: createBacktestSessionSchema } }, async (req, reply) =>
    reply.status(201).send(await createBacktestSession(app.db, req.user, req.body)),
  );

  app.get('/backtest/sessions/:id', { schema: { tags, params: idParams } }, (req) => getBacktestSession(app.db, req.user, req.params.id));

  app.patch('/backtest/sessions/:id', { schema: { tags, params: idParams, body: updateBacktestSessionSchema } }, (req) =>
    updateBacktestSession(app.db, req.user, req.params.id, req.body),
  );

  app.delete('/backtest/sessions/:id', { schema: { tags, params: idParams } }, async (req, reply) => {
    await deleteBacktestSession(app.db, req.user, req.params.id);
    return reply.status(204).send();
  });

  app.post('/backtest/sessions/:id/trades', { schema: { tags, params: idParams, body: openBacktestTradeSchema } }, async (req, reply) =>
    reply.status(201).send(await openBacktestTrade(app.db, req.user, req.params.id, req.body)),
  );

  app.patch('/backtest/trades/:id', { schema: { tags, params: idParams, body: updateBacktestTradeSchema } }, (req) =>
    updateBacktestTrade(app.db, app.fx, req.user, req.params.id, req.body),
  );

  app.delete('/backtest/trades/:id', { schema: { tags, params: idParams } }, async (req, reply) => {
    await deleteBacktestTrade(app.db, req.user, req.params.id);
    return reply.status(204).send();
  });
};
