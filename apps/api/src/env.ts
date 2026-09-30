import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(3001),
  /**
   * postgres://… for a real Postgres server. Anything else is a PGlite (embedded Postgres)
   * data directory; `memory://` keeps it in memory (tests).
   */
  DATABASE_URL: z.string().default('./.data/pglite'),
  UPLOAD_DIR: z.string().default('./.data/uploads'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** How often to measure the CFD/futures difference; 0 turns the scheduler off. */
  BASIS_INTERVAL_HOURS: z.coerce.number().min(0).default(4),
  /** How often to fetch the Forex Factory calendar; 0 turns it off. */
  CALENDAR_INTERVAL_HOURS: z.coerce.number().min(0).default(2),
  /**
   * How often to poll the FinancialJuice news feed, in seconds (at least 10); 0 turns it off.
   * FinancialJuice answers 429 to about the third request within a minute from one IP.
   */
  NEWS_INTERVAL_SECONDS: z.coerce
    .number()
    .min(0)
    .default(60)
    .refine((s) => s === 0 || s >= 10, 'at least 10 seconds, or 0 to turn the feed off'),
  /** The seeded admin; outside production, requests without a session act as this user (see AUTH_DEV_BYPASS). */
  DEV_USER_EMAIL: z.string().default('admin@trading.local'),
  /** Public address of the web app, e.g. https://dziennik.example.com. Used for auth origin checks and links in e-mails. */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** Signs session cookies and tokens: at least 32 random characters in production. */
  AUTH_SECRET: z.string().default('dev-secret-change-me-dev-secret-change-me'),
  /** Who can create an account: `invite` (with a code from an admin), `open`, or `closed`. */
  REGISTRATION: z.enum(['invite', 'open', 'closed']).default('invite'),
  /**
   * Development only: requests without a session act as DEV_USER_EMAIL (and `x-user-id` switches
   * user), as before login existed. Always off in production.
   */
  AUTH_DEV_BYPASS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Sender of e-mails (password reset). Until a provider is configured, e-mails are written to the log. */
  MAIL_FROM: z.string().default('Dziennik tradera <no-reply@localhost>'),
})
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.AUTH_SECRET.startsWith('dev-secret') || env.AUTH_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_SECRET'], message: 'set AUTH_SECRET to at least 32 random characters in production' });
    }
  })
  .transform((env) => ({ ...env, AUTH_DEV_BYPASS: env.NODE_ENV !== 'production' && env.AUTH_DEV_BYPASS }));

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => envSchema.parse(source);
