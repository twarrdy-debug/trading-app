import { adminUpdateUserSchema, idParams, updateInstrumentSchema } from '@trading/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { requireRole } from '../plugins/current-user.ts';
import { appStats, deleteUser, listAllInstruments, listUsers, revokeSessions, systemStatus, updateInstrument, updateUser } from '../services/admin.ts';
import { refreshNews } from '../services/news.ts';

const tags = ['admin'];

/** Administration: users, statistics, system status and instruments. Admins only. */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/admin')) requireRole(req, 'admin');
  });

  app.get('/admin/users', { schema: { tags } }, () => listUsers(app.db));

  app.patch('/admin/users/:id', { schema: { tags, params: idParams, body: adminUpdateUserSchema } }, (req) =>
    updateUser(app.db, req.user, req.params.id, req.body),
  );

  /** Signs the user out on every device. */
  app.post('/admin/users/:id/sessions/revoke', { schema: { tags, params: idParams } }, (req) => revokeSessions(app.db, req.params.id));

  /** E-mails the user a password reset link (the same as "Forgot password?"). */
  app.post('/admin/users/:id/password-reset', { schema: { tags, params: idParams } }, async (req) => {
    const [user] = await app.db.select({ email: users.email }).from(users).where(eq(users.id, req.params.id));
    if (!user?.email) throw badRequest('userNotFound');
    await app.auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: '/nowe-haslo' } });
    return { sent: true, emailConfigured: Boolean(app.env.SMTP_URL) };
  });

  app.delete('/admin/users/:id', { schema: { tags, params: idParams } }, (req) => deleteUser(app.db, req.user, req.params.id, app.uploadDir));

  app.get('/admin/stats', { schema: { tags } }, () => appStats(app.db));

  app.get('/admin/system', { schema: { tags } }, () => systemStatus({ db: app.db, newsHub: app.newsHub, env: app.env }));

  /** Polls the news feed now (outside the schedule). */
  app.post('/admin/news/refresh', { schema: { tags } }, () => refreshNews(app.db, app.news, app.newsHub));

  app.get('/admin/instruments', { schema: { tags } }, () => listAllInstruments(app.db));

  app.patch('/admin/instruments/:id', { schema: { tags, params: idParams, body: updateInstrumentSchema } }, (req) =>
    updateInstrument(app.db, req.params.id, req.body),
  );
};
