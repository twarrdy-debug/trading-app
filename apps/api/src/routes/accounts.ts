import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { accountAdjustmentSchema, accountDayParams, accountLinksSchema, createAccountSchema, deleteAccountQuerySchema, idParams, updateAccountSchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accountDayBalance, accountOverviews, createAccount, deleteAccount, deleteAdjustment, listAdjustments, setAccountLinks, setAdjustment, updateAccount } from '../services/accounts.ts';

const tags = ['konta'];

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  /** The user's trading accounts with balance, return and drawdown. */
  app.get('/accounts', { schema: { tags } }, (req) => accountOverviews(app.db, req.user));

  app.post('/accounts', { schema: { tags, body: createAccountSchema } }, async (req, reply) =>
    reply.status(201).send(await createAccount(app.db, req.user, req.body)),
  );

  app.patch('/accounts/:id', { schema: { tags, params: idParams, body: updateAccountSchema } }, (req) =>
    updateAccount(app.db, req.user, req.params.id, req.body),
  );

  /** Links the account with others (a trade copier), or unlinks it with an empty list; returns every account. */
  app.put('/accounts/:id/links', { schema: { tags, params: idParams, body: accountLinksSchema } }, async (req) => {
    await setAccountLinks(app.db, req.user, req.params.id, req.body.accountIds);
    return accountOverviews(app.db, req.user);
  });

  /** `trades`: keep them without an account (default), move them (`moveTo`), or delete them with their screenshots. */
  app.delete('/accounts/:id', { schema: { tags, params: idParams, querystring: deleteAccountQuerySchema } }, async (req, reply) => {
    const files = await deleteAccount(app.db, req.user, req.params.id, req.query);
    await Promise.all(files.map((key) => unlink(path.join(app.uploadDir, key)).catch(() => undefined)));
    return reply.status(204).send();
  });

  // --- Balance corrections (fees and commissions the trade reports leave out) ---

  app.get('/accounts/:id/adjustments', { schema: { tags, params: idParams } }, (req) => listAdjustments(app.db, req.user, req.params.id));

  /** The app's balance at the end of a day and that day's correction, if any. */
  app.get('/accounts/:id/balance/:date', { schema: { tags, params: accountDayParams } }, (req) => accountDayBalance(app.db, req.user, req.params.id, req.params.date));

  /** The broker's end-of-day balance: the difference against the app's is saved as that day's correction. */
  app.put('/accounts/:id/adjustments/:date', { schema: { tags, params: accountDayParams, body: accountAdjustmentSchema } }, (req) =>
    setAdjustment(app.db, req.user, req.params.id, req.params.date, req.body),
  );

  app.delete('/accounts/:id/adjustments/:date', { schema: { tags, params: accountDayParams } }, async (req, reply) => {
    await deleteAdjustment(app.db, req.user, req.params.id, req.params.date);
    return reply.status(204).send();
  });
};
