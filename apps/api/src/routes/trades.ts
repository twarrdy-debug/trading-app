import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createTradeSchema,
  idParams,
  mt5ImportFieldsSchema,
  tradeFiltersSchema,
  tradeStatsQuerySchema,
  updateTradeSchema,
} from '@trading/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { trades, tradeScreenshots } from '../db/schema.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { importMt5 } from '../services/mt5-import.ts';
import { createTrade, deleteTrade, getTrade, listTrades, tradeStats, tradingMonitor, updateTrade } from '../services/trades.ts';

/**
 * The image type read from the file's first bytes. The type the browser declares is not trusted:
 * anything that is not really a PNG, JPEG or WebP is refused.
 */
function imageType(bytes: Buffer): { mimeType: string; ext: string } | null {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { mimeType: 'image/png', ext: 'png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Storage keys as the upload creates them (a UUID and the image extension). */
const STORAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

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

  app.get('/trades/monitor', { schema: { tags } }, (req) => tradingMonitor(app.db, req.user));

  /**
   * Import from an MetaTrader 5 history report (multipart: `file` plus the text fields of
   * mt5ImportFieldsSchema). Without `commit=true` it only returns the preview.
   */
  app.post('/trades/import/mt5', { schema: { tags, consumes: ['multipart/form-data'] }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const fields: Record<string, string> = {};
    let bytes: Buffer | null = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') bytes = await part.toBuffer();
        else fields[part.fieldname] = String(part.value);
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'fileTooLarge');
      throw err;
    }
    if (!bytes) throw badRequest('noFile');
    const parsed = mt5ImportFieldsSchema.safeParse(fields);
    if (!parsed.success) throw badRequest('invalidData', {}, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    return importMt5(ctx, req.user, new Uint8Array(bytes), parsed.data);
  });

  app.get('/trades/:id', { schema: { tags, params: idParams } }, (req) => getTrade(app.db, req.user, req.params.id));

  app.post('/trades', { schema: { tags, body: createTradeSchema } }, async (req, reply) => {
    const { fxWarning: _fxWarning, ...result } = await createTrade(ctx, req.user, req.body);
    return reply.status(201).send(result);
  });

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
    { schema: { tags, params: idParams, consumes: ['multipart/form-data'] }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      await getTrade(app.db, req.user, req.params.id);
      const file = await req.file();
      if (!file) throw badRequest('noFile');
      let bytes: Buffer;
      try {
        bytes = await file.toBuffer();
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'fileTooLarge');
        throw err;
      }
      const type = imageType(bytes);
      if (!type) throw badRequest('imageFormats');

      const storageKey = `${randomUUID()}.${type.ext}`;
      await writeFile(path.join(app.uploadDir, storageKey), bytes);

      const [row] = await app.db
        .insert(tradeScreenshots)
        .values({ tradeId: req.params.id, storageKey, mimeType: type.mimeType, sizeBytes: bytes.length })
        .returning();
      return reply.status(201).send({ id: row!.id, url: `/files/${storageKey}`, mimeType: row!.mimeType, sizeBytes: row!.sizeBytes });
    },
  );

  /** A screenshot file, only for the owner of its trade (404 for anyone else, as if it did not exist). */
  app.get('/files/:key', { schema: { hide: true, params: z.object({ key: z.string() }) } }, async (req, reply) => {
    const { key } = req.params;
    if (!STORAGE_KEY.test(key)) throw notFound();
    const [owned] = await app.db
      .select({ id: tradeScreenshots.id })
      .from(tradeScreenshots)
      .innerJoin(trades, eq(trades.id, tradeScreenshots.tradeId))
      .where(and(eq(tradeScreenshots.storageKey, key), eq(trades.userId, req.user.id)));
    if (!owned) throw notFound();
    // Private: shared caches (Cloudflare) must not keep one user's screenshot for others.
    return reply.header('cache-control', 'private, max-age=86400').sendFile(key, { cacheControl: false });
  });

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
      if (!deleted) throw notFound('screenshotNotFound');
      await removeFiles([deleted.storageKey]);
      return reply.status(204).send();
    },
  );
};
