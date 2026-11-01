import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'pm_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client', () => {
  it('sends cookies and echoes the CSRF cookie in X-CSRF-Token on mutations', async () => {
    document.cookie = 'pm_csrf=abc123';
    const fetchMock = stubFetch(200, { ok: true });
    await api('/auth/login', { method: 'POST', body: { email: 'a@b.co' } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('abc123');
  });

  it('does not send a CSRF header on GET', async () => {
    const fetchMock = stubFetch(200, {});
    await api('/auth/me');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('throws ApiError carrying the server error envelope', async () => {
    stubFetch(401, { code: 'INVALID_CREDENTIALS', message: 'nope', requestId: 'r1' });
    const err = await api('/auth/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).body.code).toBe('INVALID_CREDENTIALS');
  });
});
