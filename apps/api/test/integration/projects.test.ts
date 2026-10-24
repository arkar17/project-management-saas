import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp, csrf } from '../helpers.js';
import { createIssue, createUser, createWorkspace, db, signIn } from './setup.js';

const api = '/api/v1';
const as = (cookie: string) => csrf([cookie]);

/** Workspace with Owner, Admin, a PM, a project Member and an outsider workspace member. */
async function world() {
  const { app } = buildApp({ db });
  const users = {
    owner: await createUser('owner@p.test'),
    admin: await createUser('admin@p.test'),
    pm: await createUser('pm@p.test'),
    member: await createUser('member@p.test'),
    outsider: await createUser('outsider@p.test'),
  };
  const { workspace } = await createWorkspace('proj-co', users.owner.id);
  const wid = workspace.id;
  await db.workspaceMember.createMany({
    data: [
      { workspaceId: wid, userId: users.admin.id, role: 'ADMIN' },
      { workspaceId: wid, userId: users.pm.id, role: 'MEMBER' },
      { workspaceId: wid, userId: users.member.id, role: 'MEMBER' },
      { workspaceId: wid, userId: users.outsider.id, role: 'MEMBER' },
    ],
  });
  const cookies = {
    owner: await signIn(app, users.owner.email),
    admin: await signIn(app, users.admin.email),
    pm: await signIn(app, users.pm.email),
    member: await signIn(app, users.member.email),
    outsider: await signIn(app, users.outsider.email),
  };
  const created = await request(app)
    .post(`${api}/workspaces/${wid}/projects`)
    .set(as(cookies.admin))
    .send({ key: 'web', name: 'Website', startDate: '2026-11-01', targetDate: '2026-12-01' });
  const pid: string = created.body.project.id;
  const pmRow = await db.projectMember.create({
    data: { projectId: pid, userId: users.pm.id, role: 'PROJECT_MANAGER' },
  });
  const memberRow = await db.projectMember.create({
    data: { projectId: pid, userId: users.member.id, role: 'MEMBER' },
  });
  return { app, wid, pid, users, cookies, created, pmRow, memberRow };
}

describe('FR-PRJ-001 creation', () => {
  it('TC-PRJ-001-1 key normalised and unique per workspace; default status ACTIVE; start ≤ target; audited', async () => {
    const { app, wid, created, cookies } = await world();
    expect(created.status).toBe(201);
    expect(created.body.project).toMatchObject({
      key: 'WEB',
      status: 'ACTIVE',
      startDate: '2026-11-01',
      myAccess: 'ADMIN',
    });
    expect(await db.auditLog.count({ where: { action: 'project.created' } })).toBe(1);

    const dup = await request(app)
      .post(`${api}/workspaces/${wid}/projects`)
      .set(as(cookies.owner))
      .send({ key: 'WEB', name: 'Again' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('PROJECT_KEY_TAKEN');
    const badKey = await request(app)
      .post(`${api}/workspaces/${wid}/projects`)
      .set(as(cookies.owner))
      .send({ key: 'W', name: 'Bad' });
    expect(badKey.status).toBe(422);
    const badDates = await request(app)
      .post(`${api}/workspaces/${wid}/projects`)
      .set(as(cookies.owner))
      .send({ key: 'DT', name: 'Dates', startDate: '2026-12-02', targetDate: '2026-12-01' });
    expect(badDates.status).toBe(422);

    // The same key is allowed in another workspace.
    const other = await createUser('other@p.test');
    const { workspace: ws2 } = await createWorkspace('other-co', other.id);
    const otherCookie = await signIn(app, other.email);
    expect(
      (
        await request(app)
          .post(`${api}/workspaces/${ws2.id}/projects`)
          .set(as(otherCookie))
          .send({ key: 'WEB', name: 'Web' })
      ).status,
    ).toBe(201);
  });

  it('only Owner/Admin can create projects (PM and Member → 403)', async () => {
    const { app, wid, cookies } = await world();
    for (const who of ['pm', 'member'] as const) {
      const res = await request(app)
        .post(`${api}/workspaces/${wid}/projects`)
        .set(as(cookies[who]))
        .send({ key: 'NO', name: 'Nope' });
      expect(res.status, who).toBe(403);
    }
  });

  it('TC-PRJ-001-2 PATCH cannot change the key (422); dates re-checked against stored values', async () => {
    const { app, pid, cookies } = await world();
    const res = await request(app)
      .patch(`${api}/projects/${pid}`)
      .set(as(cookies.owner))
      .send({ key: 'NEW' });
    expect(res.status).toBe(422);
    expect((await db.project.findUniqueOrThrow({ where: { id: pid } })).key).toBe('WEB');
    const late = await request(app)
      .patch(`${api}/projects/${pid}`)
      .set(as(cookies.owner))
      .send({ startDate: '2027-01-01' });
    expect(late.status).toBe(422);
    const ok = await request(app)
      .patch(`${api}/projects/${pid}`)
      .set(as(cookies.pm))
      .send({ name: 'Website v2', status: 'ON_HOLD', description: 'Marketing site' });
    expect(ok.status).toBe(200);
    expect(ok.body.project).toMatchObject({
      name: 'Website v2',
      status: 'ON_HOLD',
      key: 'WEB',
      myAccess: 'PROJECT_MANAGER',
    });
    expect(
      (
        await request(app)
          .patch(`${api}/projects/${pid}`)
          .set(as(cookies.member))
          .send({ name: 'Mine' })
      ).status,
    ).toBe(403);
  });
});

describe('GAP-02 schema default', () => {
  it('Project.status defaults to ACTIVE in the database (SRS FR-PRJ-001)', async () => {
    const owner = await createUser('default@p.test');
    const { project } = await createWorkspace('default-co', owner.id); // no status given
    expect(project.status).toBe('ACTIVE');
    const [row] = await db.$queryRaw<{ column_default: string }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'Project' AND column_name = 'status'`;
    expect(row?.column_default).toBe(`'ACTIVE'::"ProjectStatus"`);
  });
});

describe('FR-PRJ-002 visibility', () => {
  it('TC-PRJ-002-1 list returns only accessible projects; search and filters apply', async () => {
    const { app, wid, cookies, users } = await world();
    const secret = await db.project.create({
      data: {
        workspaceId: wid,
        key: 'SEC',
        name: 'Secret',
        createdById: users.owner.id,
        status: 'PLANNED',
      },
    });
    const list = (cookie: string, query = '') =>
      request(app).get(`${api}/workspaces/${wid}/projects${query}`).set('Cookie', cookie);

    // createWorkspace() fixture adds an ACTIVE (DB default) "PROJ" project with no members.
    expect((await list(cookies.owner)).body.total).toBe(3);
    const memberView = await list(cookies.member);
    expect(memberView.body.projects.map((p: { key: string }) => p.key)).toEqual(['WEB']);
    expect(memberView.body.projects[0].myAccess).toBe('PROJECT_MEMBER');
    expect((await list(cookies.outsider)).body.total).toBe(0);

    expect(
      (await list(cookies.owner, '?search=secr')).body.projects.map((p: { key: string }) => p.key),
    ).toEqual(['SEC']);
    expect((await list(cookies.owner, '?status=PLANNED')).body.total).toBe(1);
    expect((await list(cookies.owner, '?pageSize=1')).body).toMatchObject({
      total: 3,
      pageSize: 1,
    });
    expect((await list(cookies.owner, '?pageSize=500')).status).toBe(422);

    // Hidden project detail is a 404 for non-members, visible to Owner/Admin.
    expect(
      (await request(app).get(`${api}/projects/${secret.id}`).set('Cookie', cookies.member)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`${api}/projects/${secret.id}`).set('Cookie', cookies.admin)).body
        .project.myAccess,
    ).toBe('ADMIN');
  });

  it('cross-workspace project ids → 404 for every route', async () => {
    const { app, cookies } = await world();
    const stranger = await createUser('stranger@x.test');
    const { project } = await createWorkspace('stranger-co', stranger.id);
    const url = `${api}/projects/${project.id}`;
    expect((await request(app).get(url).set('Cookie', cookies.owner)).status).toBe(404);
    expect((await request(app).get(`${url}/members`).set('Cookie', cookies.owner)).status).toBe(
      404,
    );
    expect(
      (await request(app).get(`${url}/reports/overview`).set('Cookie', cookies.owner)).status,
    ).toBe(404);
    expect(
      (await request(app).patch(url).set(as(cookies.owner)).send({ name: 'Hijack' })).status,
    ).toBe(404);
    expect((await request(app).post(`${url}/archive`).set(as(cookies.owner))).status).toBe(404);
    // Listing a foreign workspace's projects is a 404 too.
    expect(
      (
        await request(app)
          .get(`${api}/workspaces/${project.workspaceId}/projects`)
          .set('Cookie', cookies.owner)
      ).status,
    ).toBe(404);
  });
});

describe('FR-PRJ-003 project members', () => {
  it('TC-PRJ-003-1 non-workspace users cannot be added (422); PM can add workspace members', async () => {
    const { app, pid, cookies, users } = await world();
    const stranger = await createUser('nobody@x.test');
    const res = await request(app)
      .post(`${api}/projects/${pid}/members`)
      .set(as(cookies.pm))
      .send({ userId: stranger.id, role: 'MEMBER' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NOT_WORKSPACE_MEMBER');

    const added = await request(app)
      .post(`${api}/projects/${pid}/members`)
      .set(as(cookies.pm))
      .send({ userId: users.outsider.id, role: 'PROJECT_MANAGER' });
    expect(added.status).toBe(201);
    expect(added.body.members).toHaveLength(3);
    // Project role only: the PM grant never changes workspace roles.
    expect(
      (await db.workspaceMember.findFirstOrThrow({ where: { userId: users.outsider.id } })).role,
    ).toBe('MEMBER');
    const again = await request(app)
      .post(`${api}/projects/${pid}/members`)
      .set(as(cookies.pm))
      .send({ userId: users.outsider.id, role: 'MEMBER' });
    expect(again.status).toBe(409);
    // Members cannot manage membership.
    expect(
      (
        await request(app)
          .post(`${api}/projects/${pid}/members`)
          .set(as(cookies.member))
          .send({ userId: users.admin.id, role: 'MEMBER' })
      ).status,
    ).toBe(403);
  });

  it('TC-PRJ-003-2 removal revokes access, unassigns open issues, removes watches; history retained', async () => {
    const { app, wid, pid, cookies, users, memberRow } = await world();
    const open = await createIssue(wid, pid, users.owner.id, { assigneeId: users.member.id });
    await db.issueWatcher.create({ data: { issueId: open.id, userId: users.member.id } });
    await db.issueComment.create({
      data: { issueId: open.id, authorId: users.member.id, body: 'kept' },
    });

    const res = await request(app)
      .delete(`${api}/projects/${pid}/members/${memberRow.id}`)
      .set(as(cookies.pm));
    expect(res.status).toBe(204);
    expect((await db.issue.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBeNull();
    expect(await db.issueActivity.count({ where: { issueId: open.id, field: 'assigneeId' } })).toBe(
      1,
    );
    expect(await db.issueWatcher.count({ where: { userId: users.member.id } })).toBe(0);
    expect(await db.issueComment.count({ where: { authorId: users.member.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'project_member.removed' } })).toBe(1);
    // Access revoked immediately, workspace membership untouched.
    expect(
      (await request(app).get(`${api}/projects/${pid}`).set('Cookie', cookies.member)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`${api}/workspaces/${wid}`).set('Cookie', cookies.member)).status,
    ).toBe(200);

    // Re-adding reactivates the same row.
    await request(app)
      .post(`${api}/projects/${pid}/members`)
      .set(as(cookies.pm))
      .send({ userId: users.member.id, role: 'MEMBER' });
    expect(await db.projectMember.count({ where: { userId: users.member.id } })).toBe(1);
  });

  it('role changes are limited to Owner/Admin/PM and audited', async () => {
    const { app, pid, cookies, memberRow } = await world();
    const url = `${api}/projects/${pid}/members/${memberRow.id}`;
    expect(
      (await request(app).patch(url).set(as(cookies.member)).send({ role: 'PROJECT_MANAGER' }))
        .status,
    ).toBe(403);
    expect(
      (await request(app).patch(url).set(as(cookies.owner)).send({ role: 'PROJECT_MANAGER' }))
        .status,
    ).toBe(204);
    expect(await db.auditLog.count({ where: { action: 'project_member.role_changed' } })).toBe(1);
    const roster = await request(app)
      .get(`${api}/projects/${pid}/members`)
      .set('Cookie', cookies.member);
    expect(roster.body.members.find((m: { id: string }) => m.id === memberRow.id).role).toBe(
      'PROJECT_MANAGER',
    );
  });
});

describe('FR-PRJ-004 archive', () => {
  it('TC-PRJ-004-1 archived project mutations → 409 PROJECT_ARCHIVED; reads still work', async () => {
    const { app, pid, cookies, users } = await world();
    expect(
      (await request(app).post(`${api}/projects/${pid}/archive`).set(as(cookies.pm))).status,
    ).toBe(403);
    const archived = await request(app)
      .post(`${api}/projects/${pid}/archive`)
      .set(as(cookies.admin));
    expect(archived.status).toBe(200);
    expect(archived.body.project.archivedAt).not.toBeNull();

    const mutations = [
      request(app).patch(`${api}/projects/${pid}`).set(as(cookies.owner)).send({ name: 'Changed' }),
      request(app)
        .post(`${api}/projects/${pid}/members`)
        .set(as(cookies.owner))
        .send({ userId: users.outsider.id, role: 'MEMBER' }),
      request(app).post(`${api}/projects/${pid}/archive`).set(as(cookies.owner)),
    ];
    for (const res of await Promise.all(mutations)) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PROJECT_ARCHIVED');
    }
    expect(
      (await request(app).get(`${api}/projects/${pid}`).set('Cookie', cookies.member)).status,
    ).toBe(200);
    expect((await db.project.findUniqueOrThrow({ where: { id: pid } })).key).toBe('WEB');
  });

  it('TC-PRJ-004-2 unarchive by Owner/Admin restores writes; both directions audited', async () => {
    const { app, pid, cookies } = await world();
    await request(app).post(`${api}/projects/${pid}/archive`).set(as(cookies.owner));
    expect(
      (await request(app).post(`${api}/projects/${pid}/unarchive`).set(as(cookies.pm))).status,
    ).toBe(403);
    const res = await request(app).post(`${api}/projects/${pid}/unarchive`).set(as(cookies.owner));
    expect(res.status).toBe(200);
    expect(res.body.project.archivedAt).toBeNull();
    expect(
      (await request(app).post(`${api}/projects/${pid}/unarchive`).set(as(cookies.owner))).body
        .code,
    ).toBe('PROJECT_NOT_ARCHIVED');
    expect(
      (
        await request(app)
          .patch(`${api}/projects/${pid}`)
          .set(as(cookies.pm))
          .send({ name: 'Writable again' })
      ).status,
    ).toBe(200);
    const actions = (
      await db.auditLog.findMany({ where: { targetId: pid }, select: { action: true } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['project.archived', 'project.unarchived']));
  });

  it('suspended workspaces reject project mutations (403)', async () => {
    const { app, wid, pid, cookies } = await world();
    await db.workspace.update({
      where: { id: wid },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    expect(
      (
        await request(app)
          .patch(`${api}/projects/${pid}`)
          .set(as(cookies.owner))
          .send({ name: 'Renamed' })
      ).body.code,
    ).toBe('WORKSPACE_SUSPENDED');
    expect(
      (await request(app).post(`${api}/projects/${pid}/archive`).set(as(cookies.owner))).status,
    ).toBe(403);
  });
});

describe('FR-PRJ-005 overview', () => {
  it('overview reflects live issues only and is visible to project members', async () => {
    const { app, wid, pid, cookies, users } = await world();
    const day = 86_400_000;
    const done = await createIssue(wid, pid, users.owner.id);
    await db.issue.update({ where: { id: done.id }, data: { status: 'DONE' } });
    const overdue = await createIssue(wid, pid, users.owner.id);
    await db.issue.update({
      where: { id: overdue.id },
      data: { status: 'IN_PROGRESS', dueAt: new Date(Date.now() - day) },
    });
    const soon = await createIssue(wid, pid, users.owner.id);
    await db.issue.update({
      where: { id: soon.id },
      data: { dueAt: new Date(Date.now() + 2 * day) },
    });
    await createIssue(wid, pid, users.owner.id, { deletedAt: new Date() });

    const res = await request(app)
      .get(`${api}/projects/${pid}/reports/overview`)
      .set('Cookie', cookies.member);
    expect(res.status).toBe(200);
    expect(res.body.overview).toMatchObject({
      totalIssues: 3,
      doneIssues: 1,
      progressPercent: 33,
      overdueIssues: 1,
      upcomingIssues: 1,
      memberCount: 2,
      activeSprint: null,
    });
    expect(
      (
        await request(app)
          .get(`${api}/projects/${pid}/reports/overview`)
          .set('Cookie', cookies.outsider)
      ).status,
    ).toBe(404);
  });
});
