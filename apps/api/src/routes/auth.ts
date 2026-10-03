import { createInviteSchema, idParams } from '@trading/shared';
import { t } from '../i18n.ts';
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

  /**
   * Creates an invitation. One bound to an address is also e-mailed there (in the admin's language);
   * the invite stays when sending fails, and `emailed` tells the client whether it went out.
   */
  app.post('/invites', { schema: { tags: ['konto'], body: createInviteSchema } }, async (req, reply) => {
    requireRole(req, 'admin');
    const invite = await createInvite(app.db, req.user, req.body);
    let emailed = false;
    if (invite.email) {
      const language = req.user.language;
      const url = `${app.env.PUBLIC_URL}/rejestracja?kod=${encodeURIComponent(invite.code)}`;
      const expires = invite.expiresAt
        ? new Intl.DateTimeFormat(language === 'pl' ? 'pl-PL' : 'en-GB', { dateStyle: 'long', timeZone: req.user.timezone }).format(invite.expiresAt)
        : '—';
      try {
        await app.mailer.send({
          to: invite.email,
          subject: t(language, 'inviteSubject'),
          text: t(language, 'inviteBody', { inviter: req.user.displayName, url, code: invite.code, expires }),
        });
        emailed = true;
      } catch (err) {
        req.log.error(err, 'invite e-mail failed');
      }
    }
    return reply.status(201).send({ ...invite, emailed });
  });

  app.delete('/invites/:id', { schema: { tags: ['konto'], params: idParams } }, async (req, reply) => {
    requireRole(req, 'admin');
    await deleteInvite(app.db, req.params.id);
    return reply.status(204).send();
  });
};
