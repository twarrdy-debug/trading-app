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
import type { DB } from './db/client.ts';
import './fastify-context.ts';
import type { Env } from './env.ts';
import { HttpError } from './errors.ts';
import { currentUserPlugin } from './plugins/current-user.ts';
import { analysisRoutes } from './routes/analysis.ts';
import { basisRoutes } from './routes/basis.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { meRoutes } from './routes/me.ts';
import { referenceRoutes } from './routes/reference.ts';
import { signalRoutes } from './routes/signals.ts';
import { spreadRoutes } from './routes/spreads.ts';
import { tradeRoutes } from './routes/trades.ts';
import { liveQuoteProvider, type QuoteProvider } from './services/basis.ts';
import { forexFactorySource, type CalendarSource } from './services/calendar.ts';
import { frankfurterProvider, type FxProvider } from './services/fx.ts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function buildApp({
  db,
  env,
  fx = frankfurterProvider,
  quotes = liveQuoteProvider,
  calendar = forexFactorySource,
  logger = true,
}: {
  db: DB;
  env: Env;
  fx?: FxProvider;
  quotes?: QuoteProvider;
  calendar?: CalendarSource;
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
  app.decorate('uploadDir', uploadDir);

  app.setErrorHandler((error, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'Błędne dane',
        issues: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.message, details: error.details });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    return reply
      .status(status)
      .send({ error: status >= 500 ? 'Błąd serwera' : (error as Error).message });
  });

  await app.register(cors, { origin: env.CORS_ORIGIN.split(','), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  await app.register(fastifyStatic, { root: uploadDir, prefix: '/files/', index: false });

  await app.register(swagger, {
    openapi: { info: { title: 'Trading App API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(currentUserPlugin);

  app.get('/health', { schema: { hide: true } }, async () => ({ ok: true }));
  await app.register(meRoutes);
  await app.register(referenceRoutes);
  await app.register(tradeRoutes);
  await app.register(spreadRoutes);
  await app.register(basisRoutes);
  await app.register(calendarRoutes);
  await app.register(signalRoutes);
  await app.register(analysisRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
