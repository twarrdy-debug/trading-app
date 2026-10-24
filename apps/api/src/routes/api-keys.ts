import { apiAllowed, createApiKeySchema, idParams } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError } from '../errors.ts';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/api-keys.ts';

const tags = ['klucze API'];

/** The user's keys for a trading bot (Settings → API keys); a real session only, never a key itself. */
export const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/api-keys', { schema: { tags } }, (req) => {
    if (!apiAllowed(req.user)) throw new HttpError(403, 'apiKeyNotEnabled');
    return listApiKeys(app.db, req.user);
  });

  app.post('/api-keys', { schema: { tags, body: createApiKeySchema }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    // Signed in for real (not the development bypass or the demo): the password and 2FA are checked below.
    if (!req.authenticated) throw new HttpError(403, 'apiKey2fa');
    return reply.status(201).send(await createApiKey(app.db, app.auth, app.env.AUTH_SECRET, req.user, req.body));
  });

  app.delete('/api-keys/:id', { schema: { tags, params: idParams } }, async (req, reply) => {
    await revokeApiKey(app.db, req.user, req.params.id);
    return reply.status(204).send();
  });
};
