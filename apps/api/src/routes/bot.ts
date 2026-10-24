import { botTradeSchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { clientIp } from '../app.ts';
import { addBotTrade, authenticateBot } from '../services/api-keys.ts';

const tags = ['bot'];

/**
 * The only door an API key opens: a bot adds closed trades to the key's account. No session cookie
 * is read here, and the key is read nowhere else (every other route ignores it).
 */
export const botRoutes: FastifyPluginAsyncZod = async (app) => {
  // Per key (by the header, never trusted beyond counting), on top of the per-address limit.
  const perKey = { max: 60, timeWindow: '1 minute', keyGenerator: (req: { headers: Record<string, unknown>; ip: string }) => String(req.headers.authorization ?? req.ip).slice(0, 40) };

  /** Checks a key without adding anything: whether it works and until when. */
  app.get('/bot/v1/ping', { schema: { tags }, config: { rateLimit: perKey } }, async (req) => {
    const { key } = await authenticateBot(app.db, app.env.AUTH_SECRET, req.headers.authorization, clientIp(req));
    return { ok: true, expiresAt: key.expiresAt };
  });

  app.post('/bot/v1/trades', { schema: { tags, body: botTradeSchema }, config: { rateLimit: perKey } }, async (req, reply) => {
    const ip = clientIp(req);
    const auth = await authenticateBot(app.db, app.env.AUTH_SECRET, req.headers.authorization, ip);
    const result = await addBotTrade({ db: app.db, fx: app.fx }, auth, req.body, ip);
    return reply.status(result.status === 'created' ? 201 : 200).send(result);
  });
};
