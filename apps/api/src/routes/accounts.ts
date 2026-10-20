import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { accountLinksSchema, createAccountSchema, deleteAccountQuerySchema, idParams, updateAccountSchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accountOverviews, createAccount, deleteAccount, setAccountLinks, updateAccount } from '../services/accounts.ts';

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
};
