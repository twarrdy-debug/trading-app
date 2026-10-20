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
/** Fired on the window when the demo refuses a save. */
export const DEMO_BLOCKED_EVENT = 'demo-blocked';

/** The language picked on the public pages (or shown now), read fresh for each request. */
function uiLanguage(): string | undefined {
  try {
    const stored = localStorage.getItem('language');
    if (stored) return stored;
  } catch {
    // No storage: fall back to the page's language.
  }
  return typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  // The UI language: the demo answers in it (a signed-in user's API follows their settings).
  const language = uiLanguage();
  const res = await fetch(BASE + path, {
    ...rest,
    headers: { ...(language ? { 'x-language': language } : {}), ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...(headers as Record<string, string>) },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) {
    // In the demo every save is refused: the app shows one notice for all of them.
    if ((body as ApiErrorBody).code === 'demoReadOnly' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DEMO_BLOCKED_EVENT));
    throw new ApiError(res.status, body as ApiErrorBody);
  }
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
