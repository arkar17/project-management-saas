import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/tokens.js';
import { buildApp, csrf } from '../helpers.js';
import { createUser, db, PASSWORD } from './setup.js';

function setup() {
  return buildApp({ db });
}

function sessionCookie(res: request.Response, name: string): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith(`${name}=`));
  if (!cookie) throw new Error(`no ${name} cookie`);
  return cookie;
}
const pair = (cookie: string) => cookie.split(';')[0]!;

async function login(
  app: Parameters<typeof request>[0],
  email: string,
  path = '/api/v1/auth/login',
) {
  return request(app).post(path).set(csrf()).send({ email, password: PASSWORD });
}

describe('FR-AUTH-001 registration', () => {
  it('TC-AUTH-001-1 normalises email, hashes with Argon2id, sends a verification link', async () => {
    const { app, mailer, deliver } = setup();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(csrf())
      .send({ name: 'Ada', email: '  Ada@Example.COM ', password: PASSWORD });
    expect(res.status).toBe(202);

    const user = await db.user.findUniqueOrThrow({ where: { email: 'ada@example.com' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.verifiedAt).toBeNull();

    await deliver();
    const token = mailer.tokenFrom(mailer.last('ada@example.com'));
    const stored = await db.verificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).toBe(hashToken(token)); // only the hash is persisted

    const verify = await request(app).post('/api/v1/auth/verify-email').set(csrf()).send({ token });
    expect(verify.status).toBe(204);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).verifiedAt).not.toBeNull();

    const reuse = await request(app).post('/api/v1/auth/verify-email').set(csrf()).send({ token });
    expect(reuse.status).toBe(410);
  });

  it('TC-AUTH-001-2 duplicate email gets the identical 202 and an "account exists" email', async () => {
    const { app, mailer, deliver } = setup();
    await createUser('dup@example.com');
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(csrf())
      .send({ name: 'Other', email: 'DUP@example.com', password: PASSWORD });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'accepted' });
    await deliver();
    expect(mailer.last('dup@example.com')?.subject).toMatch(/already have an account/);
    expect(await db.user.count()).toBe(1);
  });
});

describe('FR-AUTH-002 sessions', () => {
  it('TC-AUTH-002-1 login sets an HttpOnly/Secure/SameSite=Lax cookie and rotates the session', async () => {
    const { app } = setup();
    await createUser('rot@example.com');
    const first = await login(app, 'rot@example.com');
    expect(first.status).toBe(200);
    const cookie = sessionCookie(first, 'pm_sid');
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const second = await request(app)
      .post('/api/v1/auth/login')
      .set(csrf([pair(cookie)]))
      .send({ email: 'rot@example.com', password: PASSWORD });
    const rotated = pair(sessionCookie(second, 'pm_sid'));
    expect(rotated).not.toBe(pair(cookie));
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', pair(cookie))).status).toBe(
      401,
    );
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', rotated);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('rot@example.com');
  });

  it('rejects wrong passwords with 401 and logs the failure without secrets (TC-AUTH-005-2)', async () => {
    const { app, logs } = setup();
    await createUser('fail@example.com');
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set(csrf())
      .send({ email: 'fail@example.com', password: 'wrong-password-123' });
    expect(res.status).toBe(401);
    const out = logs.join('');
    expect(out).toContain('auth.login_failed');
    expect(out).not.toContain('wrong-password-123');
    expect(out).not.toContain('fail@example.com');
  });

  it('logout revokes the session', async () => {
    const { app } = setup();
    await createUser('out@example.com');
    const cookie = pair(sessionCookie(await login(app, 'out@example.com'), 'pm_sid'));
    expect(
      (
        await request(app)
          .post('/api/v1/auth/logout')
          .set(csrf([cookie]))
      ).status,
    ).toBe(204);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('TC-AUTH-002-3 APP session rejected on /platform, PLATFORM session on tenant routes (401)', async () => {
    const { app } = setup();
    const user = await createUser('root@example.com');
    await db.platformAdmin.create({ data: { userId: user.id } });

    const appToken = sessionCookie(await login(app, 'root@example.com'), 'pm_sid');
    const platformRes = await login(app, 'root@example.com', '/api/v1/platform/auth/login');
    expect(platformRes.status).toBe(200);
    const platformToken = sessionCookie(platformRes, 'pm_psid');
    const appValue = pair(appToken).split('=')[1];
    const platformValue = pair(platformToken).split('=')[1];

    // Correct cookie name, wrong session kind → 401 both ways.
    expect(
      (await request(app).get('/api/v1/platform/auth/me').set('Cookie', `pm_psid=${appValue}`))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get('/api/v1/auth/me').set('Cookie', `pm_sid=${platformValue}`)).status,
    ).toBe(401);
    // Each cookie only works on its own routes.
    expect(
      (await request(app).get('/api/v1/platform/auth/me').set('Cookie', pair(appToken))).status,
    ).toBe(401);
    expect(
      (await request(app).get('/api/v1/auth/me').set('Cookie', pair(platformToken))).status,
    ).toBe(401);
    expect(
      (await request(app).get('/api/v1/platform/auth/me').set('Cookie', pair(platformToken)))
        .status,
    ).toBe(200);
  });

  it('platform login requires an ACTIVE PlatformAdmin and never reveals why (ADR-007)', async () => {
    const { app } = setup();
    const user = await createUser('notadmin@example.com');
    expect((await login(app, 'notadmin@example.com', '/api/v1/platform/auth/login')).status).toBe(
      401,
    );
    await db.platformAdmin.create({
      data: { userId: user.id, status: 'REVOKED', revokedAt: new Date() },
    });
    expect((await login(app, 'notadmin@example.com', '/api/v1/platform/auth/login')).status).toBe(
      401,
    );
  });

  it('PLATFORM sessions stop working when the PlatformAdmin record is revoked', async () => {
    const { app } = setup();
    const user = await createUser('rev@example.com');
    await db.platformAdmin.create({ data: { userId: user.id } });
    const cookie = pair(
      sessionCookie(await login(app, 'rev@example.com', '/api/v1/platform/auth/login'), 'pm_psid'),
    );
    await db.platformAdmin.update({ where: { userId: user.id }, data: { status: 'REVOKED' } });
    expect((await request(app).get('/api/v1/platform/auth/me').set('Cookie', cookie)).status).toBe(
      401,
    );
  });
});

describe('FR-AUTH-003 password reset', () => {
  it('TC-AUTH-003-1 forgot-password is account-neutral', async () => {
    const { app, mailer, deliver } = setup();
    await createUser('known@example.com');
    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(csrf())
      .send({ email: 'known@example.com' });
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(csrf())
      .send({ email: 'ghost@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    await deliver();
    expect(mailer.sent.map((m) => m.to)).toEqual(['known@example.com']);
  });

  it('TC-AUTH-003-2 reset token is single-use and expires after 1 hour (410)', async () => {
    const { app, mailer, deliver } = setup();
    const user = await createUser('reset@example.com');
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(csrf())
      .send({ email: 'reset@example.com' });
    await deliver();
    const token = mailer.tokenFrom(mailer.last());
    const stored = await db.verificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeLessThanOrEqual(
      60 * 60 * 1000 + 1000,
    );

    const body = { token, password: 'a-brand-new-password' };
    expect(
      (await request(app).post('/api/v1/auth/reset-password').set(csrf()).send(body)).status,
    ).toBe(204);
    expect(
      (await request(app).post('/api/v1/auth/reset-password').set(csrf()).send(body)).status,
    ).toBe(410);

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(csrf())
      .send({ email: 'reset@example.com' });
    await deliver();
    const expired = mailer.tokenFrom(mailer.last());
    await db.verificationToken.update({
      where: { tokenHash: hashToken(expired) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await request(app)
          .post('/api/v1/auth/reset-password')
          .set(csrf())
          .send({ ...body, token: expired })
      ).status,
    ).toBe(410);
  });

  it('TC-AUTH-003-3 reset revokes all sessions', async () => {
    const { app, mailer, deliver } = setup();
    await createUser('all@example.com');
    const cookie = pair(sessionCookie(await login(app, 'all@example.com'), 'pm_sid'));
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(csrf())
      .send({ email: 'all@example.com' });
    await deliver();
    const token = mailer.tokenFrom(mailer.last());
    await request(app)
      .post('/api/v1/auth/reset-password')
      .set(csrf())
      .send({ token, password: 'a-brand-new-password' });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
    expect((await login(app, 'all@example.com')).status).toBe(401); // old password no longer works
  });
});

describe('FR-AUTH-006 resend verification', () => {
  it('TC-AUTH-006-1 invalidates the previous token and is account-neutral', async () => {
    const { app, mailer, deliver } = setup();
    await createUser('resend@example.com', { verified: false });
    const send = (email: string) =>
      request(app).post('/api/v1/auth/resend-verification').set(csrf()).send({ email });

    expect((await send('resend@example.com')).status).toBe(202);
    await deliver();
    const first = mailer.tokenFrom(mailer.last());
    expect((await send('resend@example.com')).status).toBe(202);
    await deliver();
    const second = mailer.tokenFrom(mailer.last());
    expect((await send('nobody@example.com')).status).toBe(202);

    expect(
      (await request(app).post('/api/v1/auth/verify-email').set(csrf()).send({ token: first }))
        .status,
    ).toBe(410);
    expect(
      (await request(app).post('/api/v1/auth/verify-email').set(csrf()).send({ token: second }))
        .status,
    ).toBe(204);
  });
});
