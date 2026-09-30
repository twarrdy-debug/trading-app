// Decorations added to the Fastify instance in buildApp(). Kept in its own module so that
// clients type-checking against src/types.ts see them without loading the whole app.
import type { Auth } from './auth.ts';
import type { DB } from './db/client.ts';
import type { Env } from './env.ts';
import type { QuoteProvider } from './services/basis.ts';
import type { CalendarSource } from './services/calendar.ts';
import type { FxProvider } from './services/fx.ts';
import type { NewsHub, NewsSource } from './services/news.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    env: Env;
    fx: FxProvider;
    quotes: QuoteProvider;
    calendar: CalendarSource;
    news: NewsSource;
    newsHub: NewsHub;
    uploadDir: string;
    auth: Auth;
  }
}
