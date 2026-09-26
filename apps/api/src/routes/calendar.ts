import { calendarQuerySchema } from '@trading/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listEvents, refreshCalendar } from '../services/calendar.ts';

const tags = ['kalendarz'];

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Economic events on local days `from`..`to`, filtered by currency, impact, category or instrument. */
  app.get('/calendar', { schema: { tags, querystring: calendarQuerySchema } }, (req) =>
    listEvents(app.db, req.user, req.query),
  );

  /** Fetches the Forex Factory week now (at most once every 10 minutes). */
  app.post('/calendar/refresh', { schema: { tags } }, () => refreshCalendar(app.db, app.calendar));
};
