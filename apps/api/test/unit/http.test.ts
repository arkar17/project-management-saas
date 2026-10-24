import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp, csrf, memoryLogger, offlineDb, ORIGIN } from '../helpers.js';

const { app } = buildApp({ db: offlineDb() });

describe('API foundation', () => {
  it('liveness returns 200 with a request id and security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('propagates a well-formed upstream request id and rejects malformed ones', async () => {
    const ok = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc-12345678');
    expect(ok.headers['x-request-id']).toBe('abc-12345678');
    const bad = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id; drop');
    expect(bad.headers['x-request-id']).not.toBe('bad id; drop');
  });

  it('unknown routes return the standard 404 envelope', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      requestId: res.headers['x-request-id'],
    });
  });

  it('validation errors return 422 VALIDATION_ERROR with field details', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(csrf())
      .send({ name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    const paths = res.body.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('malformed JSON returns 422, not 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(csrf())
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(422);
  });
});

describe('TC-AUTH-002-2 CSRF header + Origin required on mutations', () => {
  const body = { email: 'a@b.co', password: '' };

  it('rejects a mutation without CSRF token', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Origin', ORIGIN).send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_FAILED');
  });

  it('rejects a mismatched header/cookie pair', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set({ ...csrf(), 'x-csrf-token': 'other' })
      .send(body);
    expect(res.status).toBe(403);
  });

  it('rejects a foreign or missing Origin even with a valid token', async () => {
    const foreign = await request(app)
      .post('/api/v1/auth/login')
      .set({ ...csrf(), Origin: 'https://evil.example' })
      .send(body);
    expect(foreign.status).toBe(403);
    const { Origin: _o, ...noOrigin } = csrf();
    const missing = await request(app).post('/api/v1/auth/login').set(noOrigin).send(body);
    expect(missing.status).toBe(403);
  });

  it('passes CSRF with matching token and allowed Origin', async () => {
    const res = await request(app).post('/api/v1/auth/login').set(csrf()).send(body);
    expect(res.status).toBe(422); // reached validation, i.e. past the CSRF check
  });

  it('GET /auth/csrf issues a readable, Secure, SameSite=Lax cookie', async () => {
    const res = await request(app).get('/api/v1/auth/csrf');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`pm_csrf=${res.body.csrfToken}`);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/HttpOnly/);
  });
});

describe('TC-AUTH-002-3 session kinds (no session presented)', () => {
  it('tenant and platform routes require a session of their own kind', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/platform/auth/me')).status).toBe(401);
  });
});

describe('TC-AUTH-005-1 rate limiting', () => {
  it('returns 429 RATE_LIMITED with Retry-After once the limit is hit', async () => {
    const rule = { windowMs: 60_000, limit: 2 };
    const limited = buildApp({
      db: offlineDb(),
      rateLimits: { login: rule, register: rule, email: rule },
    }).app;
    const send = () => request(limited).post('/api/v1/auth/login').set(csrf()).send({});
    expect((await send()).status).toBe(422);
    expect((await send()).status).toBe(422);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('NFR-02/NFR-09 log redaction', () => {
  it('never writes passwords, tokens or cookies to logs', () => {
    const { logger, lines } = memoryLogger();
    logger.info({
      body: { password: 'hunter2-secret', token: 'tok-secret' },
      req: { headers: { cookie: 'pm_sid=sess-secret', 'x-csrf-token': 'csrf-secret' } },
    });
    const out = lines.join('');
    for (const secret of ['hunter2-secret', 'tok-secret', 'sess-secret', 'csrf-secret']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
  });
});
