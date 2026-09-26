import type { RoleKey } from '@trading/shared';
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
  }
}

const PUBLIC_PREFIXES = ['/health', '/docs', '/files/'];

/**
 * Resolves the acting user. There is no login yet: every request acts as DEV_USER_EMAIL.
 * Outside production an `x-user-id` header switches user, to try out roles (e.g. an educator).
 * Replace with session auth when accounts are added.
 */
export const currentUserPlugin = fp(async (app) => {
  app.decorateRequest('user', null as unknown as CurrentUser);

  app.addHook('onRequest', async (req) => {
    if (PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;

    const override = app.env.NODE_ENV !== 'production' ? req.headers['x-user-id'] : undefined;
    const [user] =
      typeof override === 'string'
        ? await app.db.select().from(users).where(eq(users.id, override))
        : await app.db.select().from(users).where(eq(users.email, app.env.DEV_USER_EMAIL));

    if (!user) throw new HttpError(401, 'Nieznany użytkownik');
    req.user = user;
  });
});

export function requireRole(req: FastifyRequest, ...allowed: RoleKey[]) {
  if (!allowed.includes(req.user.role)) throw forbidden();
}
