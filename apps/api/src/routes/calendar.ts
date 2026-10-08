import { calendarQuerySchema, idParams } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { notFound } from '../errors.ts';
import { t } from '../i18n.ts';
import { eventHistory, listEvents, refreshCalendar } from '../services/calendar.ts';

const tags = ['kalendarz'];

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Economic events on local days `from`..`to`, filtered by currency, impact, category or instrument. */
  app.get('/calendar', { schema: { tags, querystring: calendarQuerySchema } }, (req) =>
    listEvents(app.db, req.user, req.query),
  );

  /** Earlier releases of an event, for its card (chart of past results). */
  app.get('/calendar/:id/history', { schema: { tags, params: idParams } }, async (req) => {
    const result = await eventHistory(app.db, req.params.id);
    if (!result) throw notFound();
    return result;
  });

  /** Fetches the Forex Factory week now (at most once every 10 minutes). */
  app.post('/calendar/refresh', { schema: { tags }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const result = await refreshCalendar(app.db, app.calendar);
    if (result.status === 'updated') return result;
    const message =
      result.status === 'recent' ? t(req.user.language, 'calendarRecent') : t(req.user.language, 'calendarFailed', { reason: result.message });
    return { ...result, message };
  });
};
