import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  createTradeSchema,
  idParams,
  tradeFiltersSchema,
  tradeStatsQuerySchema,
  updateTradeSchema,
} from '@trading/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { trades, tradeScreenshots } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { createTrade, deleteTrade, getTrade, listTrades, tradeStats, updateTrade } from '../services/trades.ts';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const tags = ['dziennik'];

export const tradeRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = { db: app.db, fx: app.fx };
  const removeFiles = (keys: string[]) =>
    Promise.all(keys.map((key) => unlink(path.join(app.uploadDir, key)).catch(() => undefined)));

  app.get('/trades', { schema: { tags, querystring: tradeFiltersSchema } }, (req) =>
    listTrades(app.db, req.user, req.query),
  );

  app.get('/trades/stats', { schema: { tags, querystring: tradeStatsQuerySchema } }, (req) =>
    tradeStats(app.db, req.user, req.query),
  );

  app.get('/trades/:id', { schema: { tags, params: idParams } }, (req) => getTrade(app.db, req.user, req.params.id));

  app.post('/trades', { schema: { tags, body: createTradeSchema } }, async (req, reply) =>
    reply.status(201).send(await createTrade(ctx, req.user, req.body)),
  );

  app.patch('/trades/:id', { schema: { tags, params: idParams, body: updateTradeSchema } }, (req) =>
    updateTrade(ctx, req.user, req.params.id, req.body),
  );

  app.delete('/trades/:id', { schema: { tags, params: idParams } }, async (req, reply) => {
    const trade = await getTrade(app.db, req.user, req.params.id);
    await deleteTrade(app.db, req.user, trade.id);
    await removeFiles(trade.screenshots.map((s) => path.basename(s.url)));
    return reply.status(204).send();
  });

  app.post(
    '/trades/:id/screenshots',
    { schema: { tags, params: idParams, consumes: ['multipart/form-data'] } },
    async (req, reply) => {
      await getTrade(app.db, req.user, req.params.id);
      const file = await req.file();
      if (!file) throw badRequest('Brak pliku');
      const ext = IMAGE_EXTENSIONS[file.mimetype];
      if (!ext) throw badRequest('Dozwolone formaty: PNG, JPG, WEBP');

      const storageKey = `${randomUUID()}.${ext}`;
      const target = path.join(app.uploadDir, storageKey);
      await pipeline(file.file, createWriteStream(target));
      if (file.file.truncated) {
        await removeFiles([storageKey]);
        throw new HttpError(413, 'Plik jest za duży (maks. 10 MB)');
      }

      const [row] = await app.db
        .insert(tradeScreenshots)
        .values({ tradeId: req.params.id, storageKey, mimeType: file.mimetype, sizeBytes: file.file.bytesRead })
        .returning();
      return reply.status(201).send({ id: row!.id, url: `/files/${storageKey}`, mimeType: row!.mimeType, sizeBytes: row!.sizeBytes });
    },
  );

  app.delete(
    '/trades/:id/screenshots/:screenshotId',
    { schema: { tags, params: idParams.extend({ screenshotId: z.uuid() }) } },
    async (req, reply) => {
      const owned = app.db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.id, req.params.id), eq(trades.userId, req.user.id)));
      const [deleted] = await app.db
        .delete(tradeScreenshots)
        .where(and(eq(tradeScreenshots.id, req.params.screenshotId), inArray(tradeScreenshots.tradeId, owned)))
        .returning({ storageKey: tradeScreenshots.storageKey });
      if (!deleted) throw notFound('Nie znaleziono zrzutu ekranu');
      await removeFiles([deleted.storageKey]);
      return reply.status(204).send();
    },
  );
};
