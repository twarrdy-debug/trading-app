import { checkoutSchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError, notFound } from '../errors.ts';
import { billingState, openPortal, startCheckout, syncSubscription } from '../services/billing.ts';

const tags = ['billing'];

/** Buying and managing Pro. Cards, invoices and cancelling live on Stripe's own pages. */
export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/billing', { schema: { tags } }, (req) => billingState(app.billing, app.db, req.user, req.demo, req.log));

  app.post('/billing/checkout', { schema: { tags, body: checkoutSchema }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, (req) =>
    startCheckout(app.billing, app.db, req.user, app.env.PUBLIC_URL, req.body, req.log),
  );

  app.post('/billing/portal', { schema: { tags }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, (req) =>
    openPortal(app.billing, app.db, req.user, app.env.PUBLIC_URL, req.log),
  );

  // Its own scope: the signature covers the exact bytes, so this one route keeps the body unparsed.
  await app.register(async (webhook) => {
    webhook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    webhook.post('/billing/webhook', { schema: { hide: true } }, async (req) => {
      if (!app.billing) throw notFound();
      const signature = req.headers['stripe-signature'];
      let event;
      try {
        if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) throw new Error('unsigned');
        event = app.billing.parseEvent(req.body, signature);
      } catch {
        throw new HttpError(400, 'invalidData');
      }
      // A failure here answers 500, so Stripe sends the event again later.
      if (event.subscriptionId) await syncSubscription(app.billing, app.db, event.subscriptionId, req.log);
      return { received: true };
    });
  });
};
