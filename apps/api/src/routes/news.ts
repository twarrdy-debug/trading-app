import { newsQuerySchema } from '@trading/shared';
import type { ServerResponse } from 'node:http';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listNews } from '../services/news.ts';

const tags = ['news'];
/** Keeps proxies and tunnels from closing an idle stream. */
const PING_MS = 25_000;

export const newsRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Headlines, newest first, filtered; `nextCursor` pages back in time. `feed` tells whether the feed is live. */
  app.get('/news', { schema: { tags, querystring: newsQuerySchema } }, (req) => listNews(app.db, app.newsHub, req.query));

  const streams = new Set<ServerResponse>();
  // Open streams would keep the server from closing.
  app.addHook('preClose', async () => {
    for (const res of streams) res.end();
  });

  /**
   * Server-sent events: `news` with the new headlines (JSON array) as soon as they are fetched.
   * Headlines are the same for every user, so the stream only needs a signed-in user.
   */
  app.get('/news/stream', { schema: { tags } }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx and similar proxies buffer responses unless told not to.
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    streams.add(res);

    const unsubscribe = app.newsHub.subscribe((items) => res.write(`event: news\ndata: ${JSON.stringify(items)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.raw.on('close', () => {
      unsubscribe();
      clearInterval(ping);
      streams.delete(res);
    });
  });
};
