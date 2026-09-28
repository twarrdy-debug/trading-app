import type { MessageKey } from './i18n.ts';

/**
 * Errors with a `statusCode` are sent by Fastify as that HTTP status. The message is a key from
 * i18n.ts, translated into the user's language by the error handler in app.ts.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly key: MessageKey,
    public readonly params: Record<string, string | number> = {},
    public readonly details?: unknown,
  ) {
    super(key);
  }
}

export const notFound = (key: MessageKey = 'notFound') => new HttpError(404, key);
export const forbidden = (key: MessageKey = 'forbidden') => new HttpError(403, key);
export const badRequest = (key: MessageKey, params?: Record<string, string | number>, details?: unknown) =>
  new HttpError(400, key, params, details);
