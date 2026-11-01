import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp, csrf } from '../helpers.js';
import { createIssue, createUser, createWorkspace, db, PASSWORD, signIn } from './setup.js';

const api = '/api/v1';

async function platformLogin(app: Parameters<typeof request>[0], email: string) {
  const res = await request(app)
    .post(`${api}/platform/auth/login`)
    .set(csrf())
    .send({ email, password: PASSWORD });
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('pm_psid='));
  return { res, cookie: cookie?.split(';')[0] ?? '' };
}

/** A platform admin, two tenants with content, and an ordinary user. */
async function world() {
  const { app } = buildApp({ db });
  const root = await createUser('root@p.test');
  await db.platformAdmin.create({ data: { userId: root.id } });
  const owner = await createUser('owner@p.test');
  const member = await createUser('member@p.test');
  const a = await createWorkspace('alpha-co', owner.id);
  const b = await createWorkspace('beta-co', member.id);
  await db.workspaceMember.create({
    data: { workspaceId: a.workspace.id, userId: member.id, role: 'MEMBER' },
  });
  await db.projectMember.create({
    data: { projectId: a.project.id, userId: member.id, role: 'MEMBER' },
  });
  const issue = await createIssue(a.workspace.id, a.project.id, owner.id);
  await db.issue.update({ where: { id: issue.id }, data: { title: 'TOP-SECRET-ISSUE' } });
  const comment = await db.issueComment.create({
    data: { issueId: issue.id, authorId: owner.id, body: 'TOP-SECRET-COMMENT' },
  });
  const { cookie: platform } = await platformLogin(app, root.email);
  const as = (cookie: string) => csrf([cookie]);
  const get = (cookie: string, path: string) => request(app).get(`${api}${path}`).set(as(cookie));
  const post = (cookie: string, path: string, body: object = {}) =>
    request(app).post(`${api}${path}`).set(as(cookie)).send(body);
  return { app, root, owner, member, a, b, issue, comment, platform, as, get, post };
}

describe('FR-ADM-001 platform sign-in and session separation', () => {
  it('TC-ADM-001-1 login requires an ACTIVE PlatformAdmin, issues a PLATFORM session and is audited', async () => {
    const w = await world();
    expect(w.platform).toMatch(/^pm_psid=/);
    expect((await w.get(w.platform, '/platform/auth/me')).body.user.email).toBe('root@p.test');
    expect(
      await db.auditLog.count({ where: { action: 'platform.login', actorType: 'PLATFORM_ADMIN' } }),
    ).toBe(1);

    // Ordinary users and revoked admins cannot sign in to the platform.
    expect((await platformLogin(w.app, w.owner.email)).res.status).toBe(401);
    const revoked = await createUser('revoked@p.test');
    await db.platformAdmin.create({ data: { userId: revoked.id, status: 'REVOKED' } });
    expect((await platformLogin(w.app, revoked.email)).res.status).toBe(401);
  });

  it('APP and PLATFORM sessions are never interchangeable', async () => {
    const w = await world();
    const ownerApp = await signIn(w.app, w.owner.email);
    const rootApp = await signIn(w.app, w.root.email);
    for (const path of ['/platform/metrics', '/platform/workspaces', '/platform/users']) {
      expect((await w.get(ownerApp, path)).status, path).toBe(401);
      // An admin's own APP session does not become a platform session either.
      expect((await w.get(rootApp, path)).status, path).toBe(401);
      expect((await request(w.app).get(`${api}${path}`)).status).toBe(401);
    }
    // A PLATFORM cookie is not accepted on tenant routes.
    expect((await w.get(w.platform, '/workspaces')).status).toBe(401);
    expect((await w.get(w.platform, `/projects/${w.a.project.id}/issues`)).status).toBe(401);
    expect((await w.get(w.platform, `/issues/${w.issue.id}`)).status).toBe(401);
  });

  it('revoking the PlatformAdmin record takes effect on the next request', async () => {
    const w = await world();
    expect((await w.get(w.platform, '/platform/metrics')).status).toBe(200);
    await db.platformAdmin.update({ where: { userId: w.root.id }, data: { status: 'REVOKED' } });
    // The PLATFORM session no longer resolves (401); the route guard re-checks as well.
    expect((await w.get(w.platform, '/platform/metrics')).status).toBe(401);
  });

  it('TC-ADM-001-2 / TC-ADM-003-1 the platform role grants no membership and no tenant content', async () => {
    const w = await world();
    expect(await db.workspaceMember.count({ where: { userId: w.root.id } })).toBe(0);
    const rootApp = await signIn(w.app, w.root.email);
    expect((await w.get(rootApp, '/workspaces')).body.workspaces).toEqual([]);
    for (const path of [
      `/workspaces/${w.a.workspace.id}`,
      `/projects/${w.a.project.id}/issues`,
      `/issues/${w.issue.id}`,
      `/issues/${w.issue.id}/comments`,
      `/issues/${w.issue.id}/attachments`,
    ]) {
      expect((await w.get(rootApp, path)).status, path).toBe(404);
    }
    // No tenant-content routes exist under /platform.
    for (const path of [
      `/platform/workspaces/${w.a.workspace.id}/issues`,
      `/platform/workspaces/${w.a.workspace.id}/projects`,
      `/platform/issues/${w.issue.id}`,
    ]) {
      expect((await w.get(w.platform, path)).status, path).toBe(404);
    }
    // Metadata responses never carry content, credentials or member emails.
    const bodies = JSON.stringify([
      (await w.get(w.platform, '/platform/workspaces')).body,
      (await w.get(w.platform, `/platform/workspaces/${w.a.workspace.id}`)).body,
      (await w.get(w.platform, '/platform/audit')).body,
      (await w.get(w.platform, '/platform/metrics')).body,
    ]);
    for (const secret of ['TOP-SECRET', 'passwordHash', 'tokenHash', 'owner@p.test']) {
      expect(bodies).not.toContain(secret);
    }
    const users = JSON.stringify((await w.get(w.platform, '/platform/users')).body);
    expect(users).not.toMatch(/passwordHash|argon2|tokenHash/);
  });
});

describe('FR-ADM-002 suspension', () => {
  it('TC-ADM-002-1 suspend/reactivate need a reason, are audited and gate tenant writes', async () => {
    const w = await world();
    const wid = w.a.workspace.id;
    expect((await w.post(w.platform, `/platform/workspaces/${wid}/suspend`)).status).toBe(422);
    expect(
      (await w.post(w.platform, `/platform/workspaces/${wid}/suspend`, { reason: ' ' })).status,
    ).toBe(422);
    // Sensitive actions still need CSRF.
    expect(
      (
        await request(w.app)
          .post(`${api}/platform/workspaces/${wid}/suspend`)
          .set('Cookie', w.platform)
          .send({ reason: 'abuse report' })
      ).status,
    ).toBe(403);

    const res = await w.post(w.platform, `/platform/workspaces/${wid}/suspend`, {
      reason: 'Abuse report #42',
    });
    expect(res.status).toBe(200);
    expect(res.body.workspace).toMatchObject({ status: 'SUSPENDED' });
    expect(res.body.workspace.suspendedAt).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'workspace.suspended' } });
    expect(audit).toMatchObject({
      workspaceId: wid,
      actorId: w.root.id,
      actorType: 'PLATFORM_ADMIN',
      metadata: { reason: 'Abuse report #42' },
    });
    expect(
      (await w.post(w.platform, `/platform/workspaces/${wid}/suspend`, { reason: 'again' })).status,
    ).toBe(409);

    // Tenant members: reads continue, writes are refused with 403 WORKSPACE_SUSPENDED.
    const ownerApp = await signIn(w.app, w.owner.email);
    expect((await w.get(ownerApp, `/issues/${w.issue.id}`)).status).toBe(200);
    const write = await w.post(ownerApp, `/projects/${w.a.project.id}/issues`, {
      type: 'TASK',
      title: 'blocked',
    });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('WORKSPACE_SUSPENDED');
    // The other tenant is unaffected.
    const memberApp = await signIn(w.app, w.member.email);
    expect(
      (await w.post(memberApp, `/projects/${w.b.project.id}/issues`, { type: 'TASK', title: 'ok' }))
        .status,
    ).toBe(201);

    const detail = (await w.get(w.platform, `/platform/workspaces/${wid}`)).body;
    expect(detail.statusHistory[0]).toMatchObject({
      action: 'workspace.suspended',
      metadata: { reason: 'Abuse report #42' },
      actor: { id: w.root.id },
    });

    expect((await w.post(w.platform, `/platform/workspaces/${wid}/reactivate`)).status).toBe(422);
    const back = await w.post(w.platform, `/platform/workspaces/${wid}/reactivate`, {
      reason: 'Resolved with owner',
    });
    expect(back.body.workspace).toMatchObject({ status: 'ACTIVE', suspendedAt: null });
    expect(await db.auditLog.count({ where: { action: 'workspace.reactivated' } })).toBe(1);
    expect(
      (await w.post(w.platform, `/platform/workspaces/${wid}/reactivate`, { reason: 'x2x' }))
        .status,
    ).toBe(409);
    expect(
      (await w.post(ownerApp, `/projects/${w.a.project.id}/issues`, { type: 'TASK', title: 'ok' }))
        .status,
    ).toBe(201);

    for (const id of ['00000000-0000-4000-8000-000000000000', 'nope']) {
      expect(
        (await w.post(w.platform, `/platform/workspaces/${id}/suspend`, { reason: 'abc' })).status,
      ).toBe(404);
    }
    // Tenants cannot call platform actions.
    expect(
      (await w.post(ownerApp, `/platform/workspaces/${wid}/suspend`, { reason: 'abc' })).status,
    ).toBe(401);
  });
});

describe('FR-ADM-003/004 admin tables and metrics', () => {
  it('workspaces: search, status filter and pagination over metadata', async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) await createWorkspace(`gamma-${i}`, w.member.id);
    await db.workspace.update({
      where: { id: w.b.workspace.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });

    const all = (await w.get(w.platform, '/platform/workspaces?pageSize=2')).body;
    expect(all).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(all.workspaces).toHaveLength(2);
    const page3 = (await w.get(w.platform, '/platform/workspaces?pageSize=2&page=3')).body;
    expect(page3.workspaces).toHaveLength(1);
    const gamma = (await w.get(w.platform, '/platform/workspaces?search=GAMMA')).body;
    expect(gamma.total).toBe(3);
    const suspended = (await w.get(w.platform, '/platform/workspaces?status=SUSPENDED')).body;
    expect(suspended.workspaces.map((x: { slug: string }) => x.slug)).toEqual(['beta-co']);
    const alpha = (await w.get(w.platform, '/platform/workspaces?search=alpha')).body.workspaces[0];
    expect(alpha).toMatchObject({ activeMembers: 2, projects: 1, owner: { name: 'owner' } });
    expect((await w.get(w.platform, '/platform/workspaces?pageSize=101')).status).toBe(422);
    expect((await w.get(w.platform, '/platform/workspaces?status=DELETED')).status).toBe(422);
  });

  it('users: read-only metadata with search, status filter and pagination; no account actions', async () => {
    const w = await world();
    await db.user.update({ where: { id: w.member.id }, data: { status: 'DEACTIVATED' } });
    const list = (await w.get(w.platform, '/platform/users?pageSize=2')).body;
    expect(list).toMatchObject({ total: 3, pageSize: 2 });
    const root = (await w.get(w.platform, '/platform/users?search=root')).body.users[0];
    expect(root).toMatchObject({ email: 'root@p.test', platformAdmin: true, activeWorkspaces: 0 });
    const owner = (await w.get(w.platform, '/platform/users?search=OWNER@')).body.users[0];
    expect(owner).toMatchObject({ status: 'ACTIVE', emailVerified: true, activeWorkspaces: 1 });
    const off = (await w.get(w.platform, '/platform/users?status=DEACTIVATED')).body;
    expect(off.users.map((u: { email: string }) => u.email)).toEqual(['member@p.test']);
    // The SRS defines no platform account actions.
    for (const [method, path] of [
      ['post', `/platform/users/${w.owner.id}/deactivate`],
      ['patch', `/platform/users/${w.owner.id}`],
      ['delete', `/platform/users/${w.owner.id}`],
      ['post', `/platform/users/${w.owner.id}/platform-admin`],
    ] as const) {
      expect(
        (await request(w.app)[method](`${api}${path}`).set(w.as(w.platform)).send({})).status,
      ).toBe(404);
    }
    expect(await db.platformAdmin.count()).toBe(1);
  });

  it('TC-ADM-004-1 metrics: workspace counts, active members and job health', async () => {
    const w = await world();
    await db.workspace.update({
      where: { id: w.b.workspace.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    await db.outboxEvent.createMany({
      data: [
        { topic: 't', aggregateId: '1', payload: {} },
        { topic: 't', aggregateId: '2', payload: {}, attempts: 2 },
        { topic: 't', aggregateId: '3', payload: {}, status: 'DEAD', attempts: 8 },
      ],
    });
    const m = (await w.get(w.platform, '/platform/metrics')).body;
    expect(m.workspaces).toEqual({ total: 2, active: 1, suspended: 1 });
    expect(m.users).toEqual({ total: 3, active: 3 });
    // owner + member are active in alpha; member's own workspace is suspended.
    expect(m.activeMembers).toBe(2);
    expect(m.jobs).toMatchObject({ pending: 2, dead: 1, retrying: 1 });
    expect(m.jobs.oldestPendingAt).not.toBeNull();
  });

  it('audit: filters by action, workspace and actor type; tenant metadata is withheld', async () => {
    const w = await world();
    await w.post(w.platform, `/platform/workspaces/${w.a.workspace.id}/suspend`, {
      reason: 'test reason',
    });
    await db.auditLog.create({
      data: {
        workspaceId: w.b.workspace.id,
        actorId: w.member.id,
        actorType: 'USER',
        action: 'comment.moderated',
        targetType: 'IssueComment',
        targetId: w.comment.id,
        metadata: { reason: 'private tenant note' },
      },
    });
    const all = (await w.get(w.platform, '/platform/audit')).body;
    expect(all.total).toBe(3); // login, suspension, moderation
    const tenantRow = all.entries.find((e: { action: string }) => e.action === 'comment.moderated');
    expect(tenantRow.metadata).toBeNull();
    expect(JSON.stringify(all)).not.toContain('private tenant note');
    expect((await w.get(w.platform, '/platform/audit?action=workspace.')).body.total).toBe(1);
    expect(
      (await w.get(w.platform, `/platform/audit?workspaceId=${w.b.workspace.id}`)).body.total,
    ).toBe(1);
    expect((await w.get(w.platform, '/platform/audit?actorType=PLATFORM_ADMIN')).body.total).toBe(
      2,
    );
    expect(
      (await w.get(w.platform, '/platform/audit?pageSize=1&page=2')).body.entries,
    ).toHaveLength(1);
    expect((await w.get(w.platform, '/platform/audit?workspaceId=nope')).status).toBe(422);
  });
});
