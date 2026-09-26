import { buildApp } from './app.ts';
import { createDatabase } from './db/client.ts';
import { seed } from './db/seed-data.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await database.migrate();
if (env.NODE_ENV !== 'production') await seed(database.db, env.DEV_USER_EMAIL);

const app = await buildApp({ db: database.db, env });
app.addHook('onClose', () => database.close());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ host: env.HOST, port: env.PORT });
