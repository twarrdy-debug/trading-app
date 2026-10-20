import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError } from '../errors.ts';
import { DEMO_COOKIE, DEMO_TTL_MS, demoCookieValue, demoUser } from '../services/demo.ts';

/** The public demo: entering sets a signed cookie (no session, no sign-in), leaving clears it. */
export const demoRoutes: FastifyPluginAsyncZod = async (app) => {
  const secure = app.env.PUBLIC_URL.startsWith('https:');
  const cookie = (value: string, maxAge: number) =>
    `${DEMO_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  app.post('/demo', { schema: { tags: ['demo'] }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_req, reply) => {
    if (!(await demoUser(app.db))) throw new HttpError(503, 'demoUnavailable');
    reply.header('set-cookie', cookie(demoCookieValue(app.env.AUTH_SECRET), Math.floor(DEMO_TTL_MS / 1000)));
    return reply.status(204).send();
  });

  app.post('/demo/exit', { schema: { tags: ['demo'] } }, async (_req, reply) => {
    reply.header('set-cookie', cookie('', 0));
    return reply.status(204).send();
  });
};
