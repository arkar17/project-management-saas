import { CSRF_COOKIE, CSRF_HEADER, type ApiErrorBody } from '@pm/shared';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const res = await fetch(`${BASE}/auth/csrf`, { credentials: 'include' });
  const body = (await res.json()) as { csrfToken: string };
  return body.csrfToken;
}

/** JSON client: sends cookies, adds the double-submit CSRF header on mutations (ADR-001). */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers[CSRF_HEADER] = await csrfToken();

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as Partial<ApiErrorBody>;
    throw new ApiError(res.status, {
      code: body.code ?? 'INTERNAL',
      message: body.message ?? 'Something went wrong',
      details: body.details,
      requestId: body.requestId ?? '',
    });
  }
  return data as T;
}
