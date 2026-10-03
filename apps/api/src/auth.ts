import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { DB } from './db/client.ts';
import { authAccounts, authSessions, authVerifications, users } from './db/schema.ts';
import type { Env } from './env.ts';
import { t } from './i18n.ts';
import { findUsableInvite, finishSignUp } from './services/invites.ts';
import type { Mailer } from './services/mailer.ts';

/**
 * Better Auth: e-mail + password accounts, cookie sessions and password reset, stored in our own
 * tables (`users` is the Better Auth user). Mounted under /auth (the web app calls /api/auth).
 * Registration follows REGISTRATION: with `invite`, sign-up needs `inviteCode` from an admin.
 */
export function createAuth({ db, env, mailer }: { db: DB; env: Env; mailer: Mailer }) {
  return betterAuth({
    appName: 'Trading journal',
    baseURL: env.PUBLIC_URL,
    basePath: '/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_URL, ...env.CORS_ORIGIN.split(',').map((o) => o.trim())],
    database: drizzleAdapter(db, { provider: 'pg', schema: { users, authSessions, authAccounts, authVerifications } }),
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'tj',
      // Behind Cloudflare Tunnel (and Caddy) the client's address is in CF-Connecting-IP; without it
      // every visitor would share one rate limit.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    user: {
      modelName: 'users',
      fields: { name: 'displayName' },
      additionalFields: { role: { type: 'string', input: false, defaultValue: 'user' } },
    },
    session: { modelName: 'authSessions', expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    account: { modelName: 'authAccounts' },
    verification: { modelName: 'authVerifications' },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      disableSignUp: env.REGISTRATION === 'closed',
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, token }) => {
        const [row] = await db.select({ language: users.language }).from(users).where(eq(users.id, user.id));
        const language = row?.language ?? 'pl';
        const url = `${env.PUBLIC_URL}/nowe-haslo?token=${encodeURIComponent(token)}`;
        await mailer.send({
          to: user.email,
          subject: t(language, 'resetSubject'),
          text: t(language, 'resetBody', { url }),
        });
      },
    },
    rateLimit: {
      enabled: env.NODE_ENV === 'production',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email' || env.REGISTRATION !== 'invite') return;
        const invite = await findUsableInvite(db, ctx.body?.inviteCode, ctx.body?.email);
        if (!invite) throw new APIError('BAD_REQUEST', { message: 'Invalid or used invite code', code: 'INVALID_INVITE' });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        const created = ctx.context.newSession;
        if (created) await finishSignUp(db, created.user.id, (ctx.body ?? {}) as Record<string, unknown>, env.REGISTRATION === 'invite');
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
