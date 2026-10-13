import { buildApp } from './app.ts';
import { createDatabase } from './db/client.ts';
import { seed } from './db/seed-data.ts';
import { loadEnv } from './env.ts';
import { startBasisScheduler } from './services/basis.ts';
import { forexFactorySource, startCalendarScheduler } from './services/calendar.ts';
import { startAnalysisScheduler } from './services/market-analysis.ts';
import { financialJuiceRss, startNewsScheduler } from './services/news.ts';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
await database.migrate();
// Roles, emotions, instruments and the first admin; idempotent, so every start (production too)
// brings new reference data in.
await seed(database.db, env.DEV_USER_EMAIL);

const app = await buildApp({ db: database.db, env });
const stopBasis =
  env.BASIS_INTERVAL_HOURS > 0
    ? startBasisScheduler(database.db, app.quotes, env.BASIS_INTERVAL_HOURS, (msg) => app.log.info(msg))
    : () => {};
const stopCalendar =
  env.CALENDAR_INTERVAL_HOURS > 0
    ? startCalendarScheduler(database.db, forexFactorySource, env.CALENDAR_INTERVAL_HOURS, (msg) => app.log.info(msg))
    : () => {};
const stopNews =
  env.NEWS_INTERVAL_SECONDS > 0
    ? startNewsScheduler(database.db, app.news, app.newsHub, env.NEWS_INTERVAL_SECONDS, (msg) => app.log.info(msg), financialJuiceRss)
    : () => {};
const stopAnalysis =
  app.market && env.ANALYSIS_INTERVAL_MINUTES > 0
    ? startAnalysisScheduler(database.db, app.market, env.ANALYSIS_INTERVAL_MINUTES, (msg) => app.log.info(msg))
    : () => {};
app.addHook('onClose', async () => {
  stopBasis();
  stopAnalysis();
  stopCalendar();
  stopNews();
  await database.close();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

await app.listen({ host: env.HOST, port: env.PORT });
