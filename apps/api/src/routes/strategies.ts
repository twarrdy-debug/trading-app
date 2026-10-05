import {
  addStrategyRuleSchema,
  createStrategySchema,
  idParams,
  reorderStrategyRulesSchema,
  strategyRuleParams,
  updateStrategyRuleSchema,
  updateStrategySchema,
} from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  addStrategyRule,
  createStrategy,
  deleteStrategy,
  deleteStrategyRule,
  listStrategies,
  reorderStrategyRules,
  updateStrategy,
  updateStrategyRule,
} from '../services/strategies.ts';

const tags = ['strategie'];

/** The user's strategies and their rules; every rule change returns the whole strategy. */
export const strategyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/strategies', { schema: { tags } }, (req) => listStrategies(app.db, req.user));

  app.post('/strategies', { schema: { tags, body: createStrategySchema } }, async (req, reply) =>
    reply.status(201).send(await createStrategy(app.db, req.user, req.body)),
  );

  app.patch('/strategies/:id', { schema: { tags, params: idParams, body: updateStrategySchema } }, (req) =>
    updateStrategy(app.db, req.user, req.params.id, req.body),
  );

  app.delete('/strategies/:id', { schema: { tags, params: idParams } }, async (req, reply) => {
    await deleteStrategy(app.db, req.user, req.params.id);
    return reply.status(204).send();
  });

  app.post('/strategies/:id/rules', { schema: { tags, params: idParams, body: addStrategyRuleSchema } }, async (req, reply) =>
    reply.status(201).send(await addStrategyRule(app.db, req.user, req.params.id, req.body.label)),
  );

  app.put('/strategies/:id/rules/order', { schema: { tags, params: idParams, body: reorderStrategyRulesSchema } }, (req) =>
    reorderStrategyRules(app.db, req.user, req.params.id, req.body.ids),
  );

  app.patch('/strategies/:id/rules/:ruleId', { schema: { tags, params: strategyRuleParams, body: updateStrategyRuleSchema } }, (req) =>
    updateStrategyRule(app.db, req.user, req.params.id, req.params.ruleId, req.body.label),
  );

  app.delete('/strategies/:id/rules/:ruleId', { schema: { tags, params: strategyRuleParams } }, (req) =>
    deleteStrategyRule(app.db, req.user, req.params.id, req.params.ruleId),
  );
};
