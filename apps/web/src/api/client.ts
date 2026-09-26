import type { ApiErrorBody } from '@trading/api/types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.error);
  }

  /** Human-readable lines: the main message plus validation issues or details. */
  get lines(): string[] {
    const extra = this.body.issues?.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)) ?? [];
    if (Array.isArray(this.body.details)) extra.push(...this.body.details.map(String));
    return [this.message, ...extra];
  }
}

const BASE = '/api';

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(BASE + path, {
    ...rest,
    headers: json === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ error: `Błąd ${res.status}` }));
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody);
  return body as T;
}

/** Query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
