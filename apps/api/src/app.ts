import { mkdirSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createAuth } from './auth.ts';
import type { DB } from './db/client.ts';
import './fastify-context.ts';
import type { Env } from './env.ts';
import { HttpError } from './errors.ts';
import { isMessageKey, t } from './i18n.ts';
import { currentUserPlugin } from './plugins/current-user.ts';
import { accountRoutes } from './routes/accounts.ts';
import { adminRoutes } from './routes/admin.ts';
import { analysisRoutes } from './routes/analysis.ts';
import { authRoutes } from './routes/auth.ts';
import { basisRoutes } from './routes/basis.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { newsRoutes } from './routes/news.ts';
import { meRoutes } from './routes/me.ts';
import { referenceRoutes } from './routes/reference.ts';
import { signalRoutes } from './routes/signals.ts';
import { spreadRoutes } from './routes/spreads.ts';
import { strategyRoutes } from './routes/strategies.ts';
import { tradeRoutes } from './routes/trades.ts';
import { liveQuoteProvider, type QuoteProvider } from './services/basis.ts';
import { forexFactorySource, type CalendarSource } from './services/calendar.ts';
import { frankfurterProvider, type FxProvider } from './services/fx.ts';
import { logMailer, smtpMailer, type Mailer } from './services/mailer.ts';
import { financialJuiceSource, NewsHub, type NewsSource } from './services/news.ts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function buildApp({
  db,
  env,
  fx = frankfurterProvider,
  quotes = liveQuoteProvider,
  calendar = forexFactorySource,
  news = financialJuiceSource,
  mailer,
  logger = true,
}: {
  db: DB;
  env: Env;
  fx?: FxProvider;
  quotes?: QuoteProvider;
  calendar?: CalendarSource;
  news?: NewsSource;
  /** Defaults to SMTP_URL, or to writing e-mails to the log when it is not set. */
  mailer?: Mailer;
  logger?: boolean;
}) {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const uploadDir = path.resolve(env.UPLOAD_DIR);
  mkdirSync(uploadDir, { recursive: true });
  app.decorate('db', db);
  app.decorate('env', env);
  app.decorate('fx', fx);
  app.decorate('quotes', quotes);
  app.decorate('calendar', calendar);
  app.decorate('news', news);
  app.decorate('newsHub', new NewsHub());
  app.decorate('uploadDir', uploadDir);
  const outgoing = mailer ?? (env.SMTP_URL ? smtpMailer(env.SMTP_URL, env.MAIL_FROM) : logMailer((msg) => app.log.info(msg)));
  app.decorate('mailer', outgoing);
  app.decorate('auth', createAuth({ db, env, mailer: outgoing }));

  app.setErrorHandler((error, req, reply) => {
    // The user is missing when the error happens before it is resolved (e.g. unknown user).
    const language = req.user?.language ?? 'pl';
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: t(language, 'invalidData'),
        issues: error.validation.map((v) => ({
          path: v.instancePath,
          message: v.message && isMessageKey(v.message) ? t(language, v.message) : v.message,
        })),
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: t(language, error.key, error.params), details: error.details });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    return reply
      .status(status)
      .send({ error: status >= 500 ? t(language, 'serverError') : (error as Error).message });
  });

  await app.register(cors, { origin: env.CORS_ORIGIN.split(','), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], credentials: true });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  await app.register(fastifyStatic, { root: uploadDir, prefix: '/files/', index: false });

  await app.register(swagger, {
    openapi: { info: { title: 'Trading App API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });
  // The API documentation is for development only.
  if (env.NODE_ENV !== 'production') await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(currentUserPlugin);

  app.get('/health', { schema: { hide: true } }, async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(accountRoutes);
  await app.register(referenceRoutes);
  await app.register(tradeRoutes);
  await app.register(spreadRoutes);
  await app.register(basisRoutes);
  await app.register(calendarRoutes);
  await app.register(newsRoutes);
  await app.register(signalRoutes);
  await app.register(analysisRoutes);
  await app.register(strategyRoutes);
  await app.register(adminRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
