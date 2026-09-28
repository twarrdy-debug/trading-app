import { updateSettingsSchema } from '@trading/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users } from '../db/schema.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

/** `authenticated` is false for the development bypass (no real session, so no sign-out). */
export const toPublicUser = (u: CurrentUser, authenticated = true) => ({
  id: u.id,
  authenticated,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  settings: {
    accountCurrency: u.accountCurrency,
    theme: u.theme,
    language: u.language,
    accentColor: u.accentColor,
    timezone: u.timezone,
    maxTradesPerDay: u.maxTradesPerDay,
    lossStreakAlert: u.lossStreakAlert,
    lossAlertMode: u.lossAlertMode,
  },
});

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', { schema: { tags: ['użytkownik'] } }, async (req) => toPublicUser(req.user, req.authenticated));

  app.patch('/me', { schema: { tags: ['użytkownik'], body: updateSettingsSchema } }, async (req) => {
    const [updated] = await app.db.update(users).set(req.body).where(eq(users.id, req.user.id)).returning();
    return toPublicUser(updated!, req.authenticated);
  });
};
