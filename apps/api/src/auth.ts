import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblems } from '@trading/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { eq } from 'drizzle-orm';
import type { DB } from './db/client.ts';
import { authAccounts, authSessions, authTwoFactors, authVerifications, users } from './db/schema.ts';
import type { Env } from './env.ts';
import { t } from './i18n.ts';
import { findUsableInvite, finishSignUp } from './services/invites.ts';
import type { Mailer } from './services/mailer.ts';

/**
 * Better Auth: e-mail + password accounts, cookie sessions and password reset, stored in our own
 * tables (`users` is the Better Auth user). Mounted under /auth (the web app calls /api/auth).
 * Registration follows REGISTRATION: with `invite`, sign-up needs `inviteCode` from an admin.
 * Passwords follow `passwordProblems()` (shared/password.ts). Two-factor sign-in (authenticator app
 * codes, with backup codes) is optional per user, under /auth/two-factor/*.
 */
/** Endpoints that set a new password from `newPassword`. */
const PASSWORD_PATHS = new Set(['/reset-password', '/change-password']);

export function createAuth({ db, env, mailer }: { db: DB; env: Env; mailer: Mailer }) {
  return betterAuth({
    appName: 'Trading journal',
    baseURL: env.PUBLIC_URL,
    basePath: '/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_URL, ...env.CORS_ORIGIN.split(',').map((o) => o.trim())],
    database: drizzleAdapter(db, { provider: 'pg', schema: { users, authSessions, authAccounts, authVerifications, authTwoFactors } }),
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
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
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
    plugins: [
      twoFactor({
        // The name the authenticator app shows next to the codes.
        issuer: new URL(env.PUBLIC_URL).hostname,
        twoFactorTable: 'authTwoFactors',
        backupCodeOptions: { storeBackupCodes: 'encrypted' },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Every way of setting a password must meet the policy; Better Auth itself only checks the length.
        const password = ctx.path === '/sign-up/email' ? ctx.body?.password : PASSWORD_PATHS.has(ctx.path) ? ctx.body?.newPassword : undefined;
        if (typeof password === 'string' && passwordProblems(password).length > 0) {
          throw new APIError('BAD_REQUEST', { message: 'Password too weak', code: 'PASSWORD_TOO_WEAK' });
        }
        // A blocked account cannot sign in (the API refuses it anyway; this gives a clear message).
        if (ctx.path === '/sign-in/email' && typeof ctx.body?.email === 'string') {
          const [row] = await db.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.email, ctx.body.email.trim().toLowerCase()));
          if (row?.disabledAt) throw new APIError('FORBIDDEN', { message: 'Account blocked', code: 'ACCOUNT_DISABLED' });
        }
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
