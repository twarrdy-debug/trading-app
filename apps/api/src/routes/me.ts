import { updateSettingsSchema } from '@trading/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import type { CurrentUser } from '../plugins/current-user.ts';

export const toPublicUser = (u: CurrentUser) => ({
  id: u.id,
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
    account: {
      type: u.accountType,
      size: u.accountSize,
      maxDrawdownPct: u.maxDrawdownPct,
      profitTargetPct: u.profitTargetPct,
      startDate: u.accountStartDate,
    },
  },
});

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', { schema: { tags: ['użytkownik'] } }, async (req) => toPublicUser(req.user));

  app.patch('/me', { schema: { tags: ['użytkownik'], body: updateSettingsSchema } }, async (req) => {
    // The account profile is checked as a whole, as it will be after the change.
    const next = { ...req.user, ...req.body };
    if (next.accountType && next.accountSize == null) throw badRequest('accountSizeRequired');
    if (next.accountType === 'prop' && next.maxDrawdownPct == null) throw badRequest('maxDrawdownRequired');
    const [updated] = await app.db.update(users).set(req.body).where(eq(users.id, req.user.id)).returning();
    return toPublicUser(updated!);
  });
};
