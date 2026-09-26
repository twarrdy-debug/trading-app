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
  /** Until accounts exist, every request acts as this user (created by `npm run db:seed`). */
  DEV_USER_EMAIL: z.string().default('admin@trading.local'),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => envSchema.parse(source);
