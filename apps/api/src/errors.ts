/** Errors with a `statusCode` are sent by Fastify as that HTTP status. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Nie znaleziono') => new HttpError(404, what);
export const forbidden = (message = 'Brak uprawnień') => new HttpError(403, message);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
