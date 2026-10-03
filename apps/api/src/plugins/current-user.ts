import type { RoleKey } from '@trading/shared';
import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { users } from '../db/schema.ts';
import { forbidden, HttpError } from '../errors.ts';
import type {} from '../fastify-context.ts';

export type CurrentUser = typeof users.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: CurrentUser;
    /** True when the user comes from a real session (false for the development bypass). */
    authenticated: boolean;
  }
}

/** Reachable without a session: health, API docs, screenshots, auth endpoints and their config. */
const PUBLIC_PREFIXES = ['/health', '/docs', '/files/', '/auth/', '/auth-config'];

/**
 * Resolves the acting user from the Better Auth session cookie. Without a session the request is
 * rejected (401), except in development with AUTH_DEV_BYPASS: then it acts as DEV_USER_EMAIL,
 * and an `x-user-id` header switches user (to try out roles, and in tests).
 */
export const currentUserPlugin = fp(async (app) => {
  app.decorateRequest('user', null as unknown as CurrentUser);
  app.decorateRequest('authenticated', false);

  app.addHook('onRequest', async (req) => {
    if (PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;

    const session = await app.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    let user: CurrentUser | undefined;
    if (session) {
      [user] = await app.db.select().from(users).where(eq(users.id, session.user.id));
      req.authenticated = Boolean(user);
    } else if (app.env.AUTH_DEV_BYPASS) {
      const override = req.headers['x-user-id'];
      [user] =
        typeof override === 'string'
          ? await app.db.select().from(users).where(eq(users.id, override))
          : await app.db.select().from(users).where(eq(users.email, app.env.DEV_USER_EMAIL));
    }

    if (!user) throw new HttpError(401, session || app.env.AUTH_DEV_BYPASS ? 'unknownUser' : 'unauthorized');
    req.user = user;
  });
});

export function requireRole(req: FastifyRequest, ...allowed: RoleKey[]) {
  if (!allowed.includes(req.user.role)) throw forbidden();
}
