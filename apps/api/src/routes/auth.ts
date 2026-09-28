import { createInviteSchema, idParams } from '@trading/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireRole } from '../plugins/current-user.ts';
import { createInvite, deleteInvite, listInvites } from '../services/invites.ts';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * Better Auth endpoints (sign-up/sign-in/sign-out, sessions, password reset) under /auth/*.
   * The Fastify request is passed on as a Web Request and the answer (cookies included) copied back.
   */
  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    schema: { hide: true },
    async handler(req, reply) {
      const request = new Request(new URL(req.url, app.env.PUBLIC_URL), {
        method: req.method,
        headers: fromNodeHeaders(req.headers),
        body: req.method === 'GET' ? undefined : JSON.stringify(req.body ?? {}),
      });
      const response = await app.auth.handler(request);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (!['set-cookie', 'content-length', 'content-encoding'].includes(key)) reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  /** Public: what the sign-in page may offer. */
  app.get('/auth-config', { schema: { tags: ['konto'] } }, async () => ({
    registration: app.env.REGISTRATION,
    /** Development without login (AUTH_DEV_BYPASS). */
    devBypass: app.env.AUTH_DEV_BYPASS,
  }));

  // --- Invitations (admin) ---

  app.get('/invites', { schema: { tags: ['konto'] } }, async (req) => {
    requireRole(req, 'admin');
    return listInvites(app.db);
  });

  app.post('/invites', { schema: { tags: ['konto'], body: createInviteSchema } }, async (req, reply) => {
    requireRole(req, 'admin');
    return reply.status(201).send(await createInvite(app.db, req.user, req.body));
  });

  app.delete('/invites/:id', { schema: { tags: ['konto'], params: idParams } }, async (req, reply) => {
    requireRole(req, 'admin');
    await deleteInvite(app.db, req.params.id);
    return reply.status(204).send();
  });
};
