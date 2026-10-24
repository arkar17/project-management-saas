import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp, csrf } from '../helpers.js';
import { createIssue, createUser, createWorkspace, db, PASSWORD, signIn } from './setup.js';

const api = '/api/v1';
const as = (cookie: string) => csrf([cookie]);

async function world() {
  const { app } = buildApp({ db });
  const owner = await createUser('owner@u.test');
  const ada = await createUser('ada@u.test');
  const { workspace, project } = await createWorkspace('users-co', owner.id);
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: ada.id, role: 'ADMIN' },
  });
  await db.projectMember.create({
    data: { projectId: project.id, userId: ada.id, role: 'MEMBER' },
  });
  return { app, owner, ada, wid: workspace.id, pid: project.id };
}

describe('FR-AUTH-004 account self-service', () => {
  it('TC-AUTH-004-1 profile and timezone update; validation; no secrets in responses', async () => {
    const w = await world();
    const cookie = await signIn(w.app, w.ada.email);
    const me = await request(w.app).get(`${api}/users/me`).set(as(cookie));
    expect(me.body.user).toEqual({
      id: w.ada.id,
      email: 'ada@u.test',
      name: 'ada',
      timezone: 'UTC',
      emailVerified: true,
    });
    const patch = (body: object) =>
      request(w.app).patch(`${api}/users/me/preferences`).set(as(cookie)).send(body);
    const ok = await patch({ name: 'Ada L.', timezone: 'Europe/London' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ name: 'Ada L.', timezone: 'Europe/London' });
    expect(JSON.stringify(ok.body)).not.toMatch(/passwordHash|argon/);
    expect((await patch({ timezone: 'Mars/Olympus' })).status).toBe(422);
    expect((await patch({})).status).toBe(422);
    // Unknown fields (e.g. status or email) are ignored, never applied.
    await patch({ name: 'Ada', email: 'evil@x.test', status: 'DEACTIVATED' });
    const row = await db.user.findUniqueOrThrow({ where: { id: w.ada.id } });
    expect(row).toMatchObject({ email: 'ada@u.test', status: 'ACTIVE' });
  });

  it('password change needs the current password and revokes other sessions only', async () => {
    const w = await world();
    const current = await signIn(w.app, w.ada.email);
    const other = await signIn(w.app, w.ada.email);
    const change = (body: object) =>
      request(w.app).post(`${api}/users/me/password`).set(as(current)).send(body);
    expect(
      (await change({ currentPassword: 'wrong-password', newPassword: 'n3w-long-password' }))
        .status,
    ).toBe(403);
    expect((await change({ currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(422);
    expect(
      (await change({ currentPassword: PASSWORD, newPassword: 'n3w-long-password' })).status,
    ).toBe(204);
    expect((await request(w.app).get(`${api}/users/me`).set(as(current))).status).toBe(200);
    expect((await request(w.app).get(`${api}/users/me`).set(as(other))).status).toBe(401);
    const login = (password: string) =>
      request(w.app).post(`${api}/auth/login`).set(csrf()).send({ email: w.ada.email, password });
    expect((await login(PASSWORD)).status).toBe(401);
    expect((await login('n3w-long-password')).status).toBe(200);
  });

  it('TC-AUTH-004-2 deactivation is blocked while Owner of any workspace (409)', async () => {
    const w = await world();
    const cookie = await signIn(w.app, w.owner.email);
    const res = await request(w.app)
      .post(`${api}/users/me/deactivate`)
      .set(as(cookie))
      .send({ password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OWNER_PROTECTED');
    expect((await db.user.findUniqueOrThrow({ where: { id: w.owner.id } })).status).toBe('ACTIVE');
    expect((await request(w.app).get(`${api}/users/me`).set(as(cookie))).status).toBe(200);
  });

  it('TC-AUTH-004-3 deactivation revokes every session and runs the removal cascade', async () => {
    const w = await world();
    const issue = await createIssue(w.wid, w.pid, w.owner.id, { assigneeId: w.ada.id });
    await db.issueWatcher.create({ data: { issueId: issue.id, userId: w.ada.id } });
    await db.issueComment.create({ data: { issueId: issue.id, authorId: w.ada.id, body: 'kept' } });
    await db.platformAdmin.create({ data: { userId: w.ada.id } });
    const app1 = await signIn(w.app, w.ada.email);
    const app2 = await signIn(w.app, w.ada.email);
    const platform = (
      await request(w.app)
        .post(`${api}/platform/auth/login`)
        .set(csrf())
        .send({ email: w.ada.email, password: PASSWORD })
    ).headers['set-cookie'] as unknown as string[];
    const platformCookie = platform.find((c) => c.startsWith('pm_psid='))!.split(';')[0]!;

    const deactivate = (password: string) =>
      request(w.app).post(`${api}/users/me/deactivate`).set(as(app1)).send({ password });
    expect((await deactivate('wrong-password')).status).toBe(403);
    const res = await deactivate(PASSWORD);
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/pm_sid=;/);

    const user = await db.user.findUniqueOrThrow({ where: { id: w.ada.id } });
    expect(user.status).toBe('DEACTIVATED');
    expect(user.deactivatedAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: w.ada.id, revokedAt: null } })).toBe(0);
    for (const cookie of [app1, app2]) {
      expect((await request(w.app).get(`${api}/users/me`).set(as(cookie))).status).toBe(401);
    }
    expect(
      (await request(w.app).get(`${api}/platform/metrics`).set(as(platformCookie))).status,
    ).toBe(401);
    expect(
      (
        await request(w.app)
          .post(`${api}/auth/login`)
          .set(csrf())
          .send({ email: w.ada.email, password: PASSWORD })
      ).status,
    ).toBe(401);

    // ADR-012 cascade: memberships removed, open issues unassigned, watches gone, history kept.
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: w.wid, userId: w.ada.id } },
    });
    expect(member.status).toBe('REMOVED');
    expect((await db.projectMember.findFirstOrThrow({ where: { userId: w.ada.id } })).status).toBe(
      'REMOVED',
    );
    expect((await db.issue.findUniqueOrThrow({ where: { id: issue.id } })).assigneeId).toBeNull();
    expect(await db.issueWatcher.count({ where: { userId: w.ada.id } })).toBe(0);
    expect(await db.issueComment.count({ where: { authorId: w.ada.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'member.removed', actorId: w.ada.id } }),
    ).toBe(1);
  });

  it('security: CSRF on self-service mutations; PLATFORM sessions and anonymous callers rejected', async () => {
    const w = await world();
    const cookie = await signIn(w.app, w.ada.email);
    for (const [method, path, body] of [
      ['patch', '/users/me/preferences', { name: 'x' }],
      [
        'post',
        '/users/me/password',
        { currentPassword: PASSWORD, newPassword: 'n3w-long-password' },
      ],
      ['post', '/users/me/deactivate', { password: PASSWORD }],
    ] as const) {
      const noCsrf = await request(w.app)[method](`${api}${path}`).set('Cookie', cookie).send(body);
      expect(noCsrf.status, path).toBe(403);
      expect(noCsrf.body.code).toBe('CSRF_FAILED');
      expect((await request(w.app)[method](`${api}${path}`).set(csrf()).send(body)).status).toBe(
        401,
      );
    }
    await db.platformAdmin.create({ data: { userId: w.ada.id } });
    const p = (
      await request(w.app)
        .post(`${api}/platform/auth/login`)
        .set(csrf())
        .send({ email: w.ada.email, password: PASSWORD })
    ).headers['set-cookie'] as unknown as string[];
    const platformCookie = p.find((c) => c.startsWith('pm_psid='))!.split(';')[0]!;
    expect((await request(w.app).get(`${api}/users/me`).set(as(platformCookie))).status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: w.ada.id } })).status).toBe('ACTIVE');
  });
});

describe('GAP-01 workspace response contracts', () => {
  it('workspace, member and invitation responses are validated and keep their shapes', async () => {
    const w = await world();
    const owner = await signIn(w.app, w.owner.email);
    const list = await request(w.app).get(`${api}/workspaces`).set(as(owner));
    expect(list.body.workspaces[0]).toEqual({
      id: w.wid,
      slug: 'users-co',
      name: 'users-co',
      timezone: 'UTC',
      status: 'ACTIVE',
      myRole: 'OWNER',
    });
    const detail = await request(w.app).get(`${api}/workspaces/${w.wid}`).set(as(owner));
    expect(detail.body.workspace).toMatchObject({
      memberCount: 2,
      projectCount: 1,
      myRole: 'OWNER',
    });
    const members = await request(w.app).get(`${api}/workspaces/${w.wid}/members`).set(as(owner));
    expect(members.body.members[0]).toHaveProperty('email');
    const adaMember = await signIn(w.app, w.ada.email);
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.wid, userId: w.ada.id } },
      data: { role: 'MEMBER' },
    });
    const asMember = await request(w.app)
      .get(`${api}/workspaces/${w.wid}/members`)
      .set(as(adaMember));
    expect(asMember.body.members.every((m: object) => !('email' in m))).toBe(true);
    const created = await request(w.app)
      .post(`${api}/workspaces`)
      .set(as(owner))
      .send({ name: 'Second', slug: 'second-co' });
    expect(created.status).toBe(201);
    expect(created.body.workspace).toMatchObject({ slug: 'second-co', myRole: 'OWNER' });
    const invite = await request(w.app)
      .post(`${api}/workspaces/${w.wid}/invitations`)
      .set(as(owner))
      .send({ email: 'new@u.test', role: 'MEMBER' });
    expect(invite.status).toBe(201);
    expect(Object.keys(invite.body.invitation).sort()).toEqual(
      ['createdAt', 'email', 'expiresAt', 'id', 'invitedBy', 'role', 'state'].sort(),
    );
  });
});
