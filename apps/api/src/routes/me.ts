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
  /** False until the first-run introduction is finished; the web app shows it before anything else. */
  onboarded: u.onboardedAt != null,
  settings: {
    accountCurrency: u.accountCurrency,
    theme: u.theme,
    language: u.language,
    accentColor: u.accentColor,
    timezone: u.timezone,
    maxTradesPerDay: u.maxTradesPerDay,
    lossStreakAlert: u.lossStreakAlert,
    lossAlertMode: u.lossAlertMode,
    newsKeywords: u.newsKeywords,
  },
});

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', { schema: { tags: ['użytkownik'] } }, async (req) => toPublicUser(req.user, req.authenticated));

  app.patch('/me', { schema: { tags: ['użytkownik'], body: updateSettingsSchema } }, async (req) => {
    const [updated] = await app.db.update(users).set(req.body).where(eq(users.id, req.user.id)).returning();
    return toPublicUser(updated!, req.authenticated);
  });

  /** Marks the introduction as finished (or skipped). */
  app.post('/me/onboarding', { schema: { tags: ['użytkownik'] } }, async (req) => {
    const [updated] = await app.db.update(users).set({ onboardedAt: new Date() }).where(eq(users.id, req.user.id)).returning();
    return toPublicUser(updated!, req.authenticated);
  });

  /** Shows the introduction again on the next page load. */
  app.delete('/me/onboarding', { schema: { tags: ['użytkownik'] } }, async (req) => {
    const [updated] = await app.db.update(users).set({ onboardedAt: null }).where(eq(users.id, req.user.id)).returning();
    return toPublicUser(updated!, req.authenticated);
  });
};
