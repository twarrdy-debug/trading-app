// Decorations added to the Fastify instance in buildApp(). Kept in its own module so that
// clients type-checking against src/types.ts see them without loading the whole app.
import type { DB } from './db/client.ts';
import type { Env } from './env.ts';
import type { FxProvider } from './services/fx.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    env: Env;
    fx: FxProvider;
    uploadDir: string;
  }
}
