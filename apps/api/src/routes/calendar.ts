import { calendarQuerySchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { t } from '../i18n.ts';
import { listEvents, refreshCalendar } from '../services/calendar.ts';

const tags = ['kalendarz'];

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Economic events on local days `from`..`to`, filtered by currency, impact, category or instrument. */
  app.get('/calendar', { schema: { tags, querystring: calendarQuerySchema } }, (req) =>
    listEvents(app.db, req.user, req.query),
  );

  /** Fetches the Forex Factory week now (at most once every 10 minutes). */
  app.post('/calendar/refresh', { schema: { tags } }, async (req) => {
    const result = await refreshCalendar(app.db, app.calendar);
    if (result.status === 'updated') return result;
    const message =
      result.status === 'recent' ? t(req.user.language, 'calendarRecent') : t(req.user.language, 'calendarFailed', { reason: result.message });
    return { ...result, message };
  });
};
