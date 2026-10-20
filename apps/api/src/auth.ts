import { APP_NAME, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordProblems } from '@trading/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { eq } from 'drizzle-orm';
import type { DB } from './db/client.ts';
import { authAccounts, authSessions, authTwoFactors, authVerifications, users } from './db/schema.ts';
import type { Env } from './env.ts';
import { passwordResetEmail, verificationEmail, welcomeEmail } from './services/emails.ts';
import { findUsableInvite, finishSignUp } from './services/invites.ts';
import type { Mailer } from './services/mailer.ts';

/**
 * Better Auth: e-mail + password accounts, cookie sessions and password reset, stored in our own
 * tables (`users` is the Better Auth user). Mounted under /auth (the web app calls /api/auth).
 * Registration follows REGISTRATION: with `invite`, sign-up needs `inviteCode` from an admin.
 * Passwords follow `passwordProblems()` (shared/password.ts). Two-factor sign-in (authenticator app
 * codes, with backup codes) is optional per user, under /auth/two-factor/*. A new account must be
 * activated with the e-mailed link (`/aktywacja?token=…` in the web app) before it can sign in;
 * signing in to an inactive account sends a fresh link.
 */
/** Endpoints that set a new password from `newPassword`. */
const PASSWORD_PATHS = new Set(['/reset-password', '/change-password']);

export function createAuth({ db, env, mailer }: { db: DB; env: Env; mailer: Mailer }) {
  return betterAuth({
    appName: APP_NAME,
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
      additionalFields: { role: { type: 'string', input: false, defaultValue: 'standard' } },
    },
    session: { modelName: 'authSessions', expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    account: { modelName: 'authAccounts' },
    verification: { modelName: 'authVerifications' },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      requireEmailVerification: true,
      disableSignUp: env.REGISTRATION === 'closed',
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, token }) => {
        const [row] = await db.select({ language: users.language }).from(users).where(eq(users.id, user.id));
        const language = row?.language ?? 'pl';
        const url = `${env.PUBLIC_URL}/nowe-haslo?token=${encodeURIComponent(token)}`;
        await mailer.send(passwordResetEmail({ language, publicUrl: env.PUBLIC_URL, email: user.email, url }));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      // The link signs the new user in, so it lands in the app (and its introduction) at once.
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, token }) => {
        const [row] = await db.select({ language: users.language }).from(users).where(eq(users.id, user.id));
        // The web app's page confirms the token through /api/auth/verify-email and opens the app.
        const url = `${env.PUBLIC_URL}/aktywacja?token=${encodeURIComponent(token)}`;
        await mailer.send(verificationEmail({ language: row?.language ?? 'pl', publicUrl: env.PUBLIC_URL, name: user.name, email: user.email, url }));
      },
      // The welcome e-mail goes once the account is active; a failure must not undo the activation.
      afterEmailVerification: async (user) => {
        const [row] = await db.select({ language: users.language }).from(users).where(eq(users.id, user.id));
        await mailer
          .send(welcomeEmail({ language: row?.language ?? 'pl', publicUrl: env.PUBLIC_URL, email: user.email, name: user.name }))
          .catch((error: Error) => console.error(`Welcome e-mail to ${user.id} failed: ${error.message}`));
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Only a real sign-up: an address already taken gets the same answer but creates nobody.
          after: async (user, ctx) => {
            if (ctx?.path === '/sign-up/email') await finishSignUp(db, user.id, (ctx.body ?? {}) as Record<string, unknown>, env.REGISTRATION === 'invite');
          },
        },
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
        '/send-verification-email': { window: 60, max: 3 },
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
        if (ctx.path !== '/sign-up/email') return;
        if (env.REGISTRATION === 'invite') {
          const invite = await findUsableInvite(db, ctx.body?.inviteCode, ctx.body?.email);
          if (!invite) throw new APIError('BAD_REQUEST', { message: 'Invalid or used invite code', code: 'INVALID_INVITE' });
        }
        // An address already registered is said so (the owner's choice, 2026-10-20), after the invite
        // check so that only someone with a code can ask; nothing is created and the invite stays.
        if (typeof ctx.body?.email === 'string') {
          const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, ctx.body.email.trim().toLowerCase()));
          if (taken) throw new APIError('UNPROCESSABLE_ENTITY', { message: 'User already exists', code: 'USER_ALREADY_EXISTS' });
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
