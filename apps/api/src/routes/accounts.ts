import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { createAccountSchema, deleteAccountQuerySchema, idParams, updateAccountSchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accountOverviews, createAccount, deleteAccount, updateAccount } from '../services/accounts.ts';

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

  /** `trades`: keep them without an account (default), move them (`moveTo`), or delete them with their screenshots. */
  app.delete('/accounts/:id', { schema: { tags, params: idParams, querystring: deleteAccountQuerySchema } }, async (req, reply) => {
    const files = await deleteAccount(app.db, req.user, req.params.id, req.query);
    await Promise.all(files.map((key) => unlink(path.join(app.uploadDir, key)).catch(() => undefined)));
    return reply.status(204).send();
  });
};
