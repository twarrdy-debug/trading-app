import { hasFeature, LANGUAGES, type Feature, type Language, type RoleKey } from '@trading/shared';
import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { users } from '../db/schema.ts';
import { forbidden, HttpError } from '../errors.ts';
import type {} from '../fastify-context.ts';
import { demoCookieFrom, demoUser, validDemoCookie } from '../services/demo.ts';

export type CurrentUser = typeof users.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: CurrentUser;
    /** True when the user comes from a real session (false for the development bypass and the demo). */
    authenticated: boolean;
    /** The public demo: read-only sample data, entered without signing in. */
    demo: boolean;
  }
}

/** Reachable without a session: health, API docs, auth endpoints and their config, the signed unsubscribe link, entering and leaving the demo. */
const PUBLIC_PREFIXES = ['/health', '/docs', '/auth/', '/auth-config', '/email/unsubscribe', '/demo'];

/** Screens the demo does not open (owner's choice): the analysis, backtesting and news, all on outside data. */
const DEMO_LOCKED = ['/analysis', '/backtest', '/news', '/basis/pro', '/levels', '/checklists'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Routes of the Pro and VIP plans (plans.ts): a Standard user gets 403 `planPro`. */
const PLAN_ROUTES: [string, Feature][] = [
  ['/analysis', 'analysis'],
  ['/levels', 'analysis'],
  ['/checklists', 'analysis'],
  ['/backtest', 'backtest'],
  ['/news', 'news'],
  ['/basis/pro', 'calculatorPro'],
];

/**
 * Resolves the acting user from the Better Auth session cookie. Without a session the request is
 * rejected (401), except in development with AUTH_DEV_BYPASS: then it acts as DEV_USER_EMAIL,
 * and an `x-user-id` header switches user (to try out roles, and in tests).
 */
export const currentUserPlugin = fp(async (app) => {
  app.decorateRequest('user', null as unknown as CurrentUser);
  app.decorateRequest('authenticated', false);
  app.decorateRequest('demo', false);

  app.addHook('onRequest', async (req) => {
    // By the matched route pattern, not the raw (possibly percent-encoded) URL; unknown paths need a
    // session too, so they answer 401 rather than revealing which routes exist.
    const route = req.routeOptions.url;
    if (route && PUBLIC_PREFIXES.some((p) => route.startsWith(p))) return;

    const session = await app.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    let user: CurrentUser | undefined;
    if (session) {
      [user] = await app.db.select().from(users).where(eq(users.id, session.user.id));
      req.authenticated = Boolean(user);
    } else if (validDemoCookie(app.env.AUTH_SECRET, demoCookieFrom(req.headers.cookie))) {
      // The demo: one shared user, read-only, and without the screens on outside data.
      const demo = await demoUser(app.db);
      if (!demo) throw new HttpError(401, 'unauthorized');
      // Visitors read the demo in the language they chose on the public pages (errors included).
      const asked = req.headers['x-language'];
      const language = typeof asked === 'string' && (LANGUAGES as readonly string[]).includes(asked) ? (asked as Language) : demo.language;
      req.user = { ...demo, language };
      req.demo = true;
      if (!READS.has(req.method)) throw new HttpError(403, 'demoReadOnly');
      if (route && DEMO_LOCKED.some((p) => route.startsWith(p))) throw new HttpError(403, 'demoLocked');
      return;
    } else if (app.env.AUTH_DEV_BYPASS) {
      const override = req.headers['x-user-id'];
      [user] =
        typeof override === 'string'
          ? await app.db.select().from(users).where(eq(users.id, override))
          : await app.db.select().from(users).where(eq(users.email, app.env.DEV_USER_EMAIL));
    }

    if (!user) throw new HttpError(401, session || app.env.AUTH_DEV_BYPASS ? 'unknownUser' : 'unauthorized');
    if (user.disabledAt) throw new HttpError(403, 'accountDisabled');
    req.user = user;
    const gated = route ? PLAN_ROUTES.find(([prefix]) => route.startsWith(prefix)) : undefined;
    if (gated && !hasFeature(user.role, gated[1])) throw new HttpError(403, 'planPro');
  });
});

export function requireRole(req: FastifyRequest, ...allowed: RoleKey[]) {
  if (!allowed.includes(req.user.role)) throw forbidden();
}
