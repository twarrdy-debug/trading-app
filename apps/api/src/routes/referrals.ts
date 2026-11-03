import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { partnerPanel } from '../services/referrals.ts';

/** A partner's own numbers; everyone else gets `partner: null`, so the settings hide the section. */
export const referralRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/referrals', { schema: { tags: ['referrals'] } }, (req) => partnerPanel(app.db, req.user.id));
};
