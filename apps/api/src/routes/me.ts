import { featuresOf, hasFeature, STANDARD_TRADE_LIMIT, updateSettingsSchema, type DashboardWidget } from '@trading/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users } from '../db/schema.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { journalTradeCount } from '../services/trades.ts';

/** `authenticated` is false for the development bypass (no real session, so no sign-out). */
export const toPublicUser = (u: CurrentUser, authenticated = true, demo = false) => ({
  id: u.id,
  authenticated,
  /** The public demo: read-only sample data; the web app shows its banner and locks some screens. */
  demo,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
  /** False until the first-run introduction is finished; the web app shows it before anything else. */
  onboarded: u.onboardedAt != null,
  /** Two-factor sign-in (authenticator app) is on. */
  twoFactorEnabled: u.twoFactorEnabled,
  /** What the role's plan includes, and the journal's trade limit (null: none). */
  plan: { features: featuresOf(u.role), tradeLimit: hasFeature(u.role, 'unlimitedTrades') ? null : STANDARD_TRADE_LIMIT },
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
    dashboardHidden: u.dashboardHidden as DashboardWidget[],
    emailWeekAhead: u.emailWeekAhead,
    emailDaySummary: u.emailDaySummary,
    emailUpdates: u.emailUpdates,
    chartStyle: u.chartStyle ?? null,
  },
});

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', { schema: { tags: ['użytkownik'] } }, async (req) => ({
    ...toPublicUser(req.user, req.authenticated, req.demo),
    /** Trades in the journal, for the plan's limit (only counted when there is one). */
    tradesUsed: hasFeature(req.user.role, 'unlimitedTrades') ? null : await journalTradeCount(app.db, req.user),
  }));

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
