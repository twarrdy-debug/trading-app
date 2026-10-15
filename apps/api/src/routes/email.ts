import { unsubscribeSchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError } from '../errors.ts';
import { unsubscribe, verifyUnsubscribe } from '../services/digests.ts';

/**
 * Unsubscribe from a regular e-mail with the signed link in it, without signing in. The web page
 * `/wypisz` sends the fields in the body; mail clients' one-click unsubscribe (RFC 8058) POSTs to
 * the same address with them in the query.
 */
export const emailRoutes: FastifyPluginAsyncZod = async (app) => {
  // One-click unsubscribe posts "List-Unsubscribe=One-Click" as a form; the fields are in the query.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, _body, done) => done(null, {}));
  app.post('/email/unsubscribe', { schema: { tags: ['e-mail'] }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = typeof req.body === 'object' && req.body !== null && 'u' in req.body ? req.body : req.query;
    const parsed = unsubscribeSchema.safeParse(body);
    if (!parsed.success || !verifyUnsubscribe(app.env.AUTH_SECRET, parsed.data.u, parsed.data.k, parsed.data.s)) {
      throw new HttpError(400, 'invalidData');
    }
    await unsubscribe(app.db, parsed.data.u, parsed.data.k);
    return { kind: parsed.data.k };
  });
};
