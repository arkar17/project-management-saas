import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp, csrf } from '../helpers.js';
import { createUser, createWorkspace, db, signIn } from './setup.js';

const api = '/api/v1';
const as = (cookie: string) => csrf([cookie]);
const day = 86_400_000;

async function world() {
  const { app } = buildApp({ db });
  const u = {
    owner: await createUser('owner@b.test'),
    pm: await createUser('pm@b.test'),
    member: await createUser('member@b.test'),
    outsider: await createUser('outsider@b.test'),
  };
  const { workspace, project } = await createWorkspace('board-co', u.owner.id);
  await db.workspaceMember.createMany({
    data: [u.pm, u.member, u.outsider].map((x) => ({
      workspaceId: workspace.id,
      userId: x.id,
      role: 'MEMBER' as const,
    })),
  });
  await db.projectMember.createMany({
    data: [
      { projectId: project.id, userId: u.pm.id, role: 'PROJECT_MANAGER' as const },
      { projectId: project.id, userId: u.member.id, role: 'MEMBER' as const },
    ],
  });
  const c = {
    owner: await signIn(app, u.owner.email),
    pm: await signIn(app, u.pm.email),
    member: await signIn(app, u.member.email),
    outsider: await signIn(app, u.outsider.email),
  };
  const pid = project.id;
  const issue = async (title: string, extra: Record<string, unknown> = {}, cookie = c.pm) =>
    (
      await request(app)
        .post(`${api}/projects/${pid}/issues`)
        .set(as(cookie))
        .send({ type: 'TASK', title, ...extra })
    ).body.issue as {
      id: string;
      version: number;
      rank: string;
      status: string;
    };
  const sprint = async (name: string, issueIds: string[] = []) =>
    (
      await request(app)
        .post(`${api}/projects/${pid}/sprints`)
        .set(as(c.pm))
        .send({
          name,
          startAt: new Date().toISOString(),
          endAt: new Date(Date.now() + 14 * day).toISOString(),
          issueIds,
        })
    ).body.sprint as { id: string; status: string };
  const board = async (cookie = c.pm, q = '') =>
    (await request(app).get(`${api}/projects/${pid}/board${q}`).set('Cookie', cookie)).body;
  const column = async (status: string, q = '') =>
    (
      (await board(c.pm, q)).columns as {
        status: string;
        issues: { id: string; title: string }[];
      }[]
    ).find((col) => col.status === status)!.issues;
  const move = (cookie: string, id: string, body: Record<string, unknown>) =>
    request(app).patch(`${api}/issues/${id}/status`).set(as(cookie)).send(body);
  const rank = (cookie: string, id: string, body: Record<string, unknown>) =>
    request(app).patch(`${api}/issues/${id}/rank`).set(as(cookie)).send(body);
  return { app, pid, workspace, project, u, c, issue, sprint, board, column, move, rank };
}

describe('FR-BRD board', () => {
  it('TC-BRD-001-1 five columns; any-to-any transitions; sprint membership unaffected', async () => {
    const w = await world();
    const a = await w.issue('A');
    const s = await w.sprint('S1', [a.id]);
    const cols = (await w.board()).columns.map((col: { status: string }) => col.status);
    expect(cols).toEqual(['BACKLOG', 'TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);
    let version = (await db.issue.findUniqueOrThrow({ where: { id: a.id } })).version;
    for (const status of ['DONE', 'BACKLOG', 'IN_REVIEW', 'TO_DO']) {
      const res = await w.move(w.c.pm, a.id, { version, status });
      expect(res.status, status).toBe(200);
      version = res.body.issue.version;
    }
    expect((await db.issue.findUniqueOrThrow({ where: { id: a.id } })).sprintId).toBe(s.id);
  });

  it('TC-BRD-002-1/2 Members move own assigned/reported issues (board and form); others → 403', async () => {
    const w = await world();
    const reported = await w.issue('Mine', {}, w.c.member);
    const assigned = await w.issue('Assigned', { assigneeId: w.u.member.id });
    const others = await w.issue('Not mine');
    expect(
      (await w.move(w.c.member, reported.id, { version: reported.version, status: 'IN_PROGRESS' }))
        .status,
    ).toBe(200);
    const viaForm = await request(w.app)
      .patch(`${api}/issues/${assigned.id}`)
      .set(as(w.c.member))
      .send({ version: assigned.version, status: 'IN_REVIEW' });
    expect(viaForm.status).toBe(200);
    const denied = await w.move(w.c.member, others.id, { version: others.version, status: 'DONE' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FIELD_FORBIDDEN');
  });

  it('TC-BRD-003-2 Member rank-only change → 403; Member move ignores position and appends', async () => {
    const w = await world();
    const a = await w.issue('A', { status: 'TO_DO' });
    const b = await w.issue('B', { status: 'TO_DO' });
    const mine = await w.issue('Mine', {}, w.c.member);
    expect(
      (await w.rank(w.c.member, mine.id, { version: mine.version, scope: 'board', afterId: null }))
        .status,
    ).toBe(403);
    const moved = await w.move(w.c.member, mine.id, {
      version: mine.version,
      status: 'TO_DO',
      afterId: null,
    });
    expect(moved.status).toBe(200);
    expect((await w.column('TO_DO')).map((i) => i.title)).toEqual(['A', 'B', 'Mine']);
    // PM can position precisely: top of the column, then after A.
    const top = await w.move(w.c.pm, mine.id, {
      version: moved.body.issue.version,
      status: 'TO_DO',
      afterId: null,
    });
    expect((await w.column('TO_DO')).map((i) => i.title)).toEqual(['Mine', 'A', 'B']);
    await w.rank(w.c.pm, mine.id, {
      version: top.body.issue.version,
      scope: 'board',
      afterId: a.id,
    });
    expect((await w.column('TO_DO')).map((i) => i.title)).toEqual(['A', 'Mine', 'B']);
    expect(b).toBeDefined();
  });

  it('TC-BRD-003-1 concurrent inserts after the same anchor stay distinct and ordered', async () => {
    const w = await world();
    const anchor = await w.issue('Anchor', { status: 'TO_DO' });
    const tail = await w.issue('Tail', { status: 'TO_DO' });
    const movers = await Promise.all(['M1', 'M2', 'M3', 'M4'].map((t) => w.issue(t)));
    const results = await Promise.all(
      movers.map((m) =>
        w.move(w.c.pm, m.id, { version: m.version, status: 'TO_DO', afterId: anchor.id }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const col = await w.column('TO_DO');
    expect(col[0]!.title).toBe('Anchor');
    expect(col.at(-1)!.title).toBe('Tail');
    const ranks = (
      await db.issue.findMany({
        where: { projectId: w.pid, status: 'TO_DO' },
        select: { rank: true },
      })
    ).map((r) => r.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(tail).toBeDefined();
  });

  it('rebalances in the same transaction when keys get too long, preserving order', async () => {
    const w = await world();
    const a = await w.issue('A', { status: 'TO_DO' });
    const b = await w.issue('B', { status: 'TO_DO' });
    const c = await w.issue('C');
    // Neighbours with no room left at a 64-character key length.
    await db.issue.update({ where: { id: a.id }, data: { rank: 'i'.repeat(63) + '0' } });
    await db.issue.update({ where: { id: b.id }, data: { rank: 'i'.repeat(63) + '1' } });
    const res = await w.move(w.c.pm, c.id, { version: c.version, status: 'TO_DO', afterId: a.id });
    expect(res.status).toBe(200);
    expect((await w.column('TO_DO')).map((i) => i.title)).toEqual(['A', 'C', 'B']);
    const ranks = (
      await db.issue.findMany({ where: { projectId: w.pid }, select: { rank: true } })
    ).map((r) => r.rank);
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThanOrEqual(64);
  });

  it('stale versions and stale anchors → 409; filters apply; archived → 409; outsiders → 404', async () => {
    const w = await world();
    const a = await w.issue('Bug A', { type: 'BUG', priority: 'HIGH', assigneeId: w.u.member.id });
    await w.issue('Task B');
    expect((await w.move(w.c.pm, a.id, { version: a.version + 5, status: 'DONE' })).body.code).toBe(
      'VERSION_CONFLICT',
    );
    const other = await w.issue('In TO_DO', { status: 'TO_DO' });
    expect(
      (await w.move(w.c.pm, a.id, { version: a.version, status: 'DONE', afterId: other.id }))
        .status,
    ).toBe(409);
    const flat = (q: string) =>
      w
        .board(w.c.pm, q)
        .then((b) =>
          b.columns.flatMap((col: { issues: { title: string }[] }) =>
            col.issues.map((i) => i.title),
          ),
        );
    expect(await flat('?type=BUG')).toEqual(['Bug A']);
    expect(await flat('?priority=HIGH')).toEqual(['Bug A']);
    expect(await flat(`?assignee=${w.u.member.id}`)).toEqual(['Bug A']);
    expect(
      (await request(w.app).get(`${api}/projects/${w.pid}/board`).set('Cookie', w.c.outsider))
        .status,
    ).toBe(404);
    await request(w.app).post(`${api}/projects/${w.pid}/archive`).set(as(w.c.owner));
    expect((await w.move(w.c.pm, a.id, { version: a.version, status: 'DONE' })).body.code).toBe(
      'PROJECT_ARCHIVED',
    );
    expect(
      (await w.rank(w.c.pm, a.id, { version: a.version, scope: 'board', afterId: null })).body.code,
    ).toBe('PROJECT_ARCHIVED');
  });
});

describe('backlog', () => {
  it('lists unsprinted, not-done issues in rank order; PM+ reorder; status preserved across sprint changes', async () => {
    const w = await world();
    const a = await w.issue('A');
    const b = await w.issue('B', { status: 'IN_PROGRESS' });
    await w.issue('Done', { status: 'DONE' });
    const backlog = async () =>
      (
        await request(w.app).get(`${api}/projects/${w.pid}/backlog`).set('Cookie', w.c.member)
      ).body.issues.map((i: { title: string }) => i.title);
    expect(await backlog()).toEqual(['A', 'B']);
    expect(
      (await w.rank(w.c.pm, b.id, { version: b.version, scope: 'backlog', afterId: null })).status,
    ).toBe(200);
    expect(await backlog()).toEqual(['B', 'A']);

    const s = await w.sprint('S1');
    const add = await request(w.app)
      .put(`${api}/sprints/${s.id}/issues`)
      .set(as(w.c.pm))
      .send({ add: [b.id] });
    expect(add.status).toBe(200);
    expect(await backlog()).toEqual(['A']);
    expect((await db.issue.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('IN_PROGRESS');
    await request(w.app)
      .put(`${api}/sprints/${s.id}/issues`)
      .set(as(w.c.pm))
      .send({ remove: [b.id] });
    expect(await backlog()).toEqual(['B', 'A']);
    expect(
      (
        await request(w.app)
          .put(`${api}/sprints/${s.id}/issues`)
          .set(as(w.c.member))
          .send({ add: [a.id] })
      ).status,
    ).toBe(403);
  });
});

describe('FR-SPR sprints', () => {
  it('TC-SPR-001-1 startAt < endAt; PM+ only', async () => {
    const w = await world();
    const now = Date.now();
    const body = {
      name: 'S',
      startAt: new Date(now + day).toISOString(),
      endAt: new Date(now).toISOString(),
    };
    expect(
      (await request(w.app).post(`${api}/projects/${w.pid}/sprints`).set(as(w.c.pm)).send(body))
        .status,
    ).toBe(422);
    const ok = { ...body, endAt: new Date(now + 2 * day).toISOString() };
    expect(
      (await request(w.app).post(`${api}/projects/${w.pid}/sprints`).set(as(w.c.member)).send(ok))
        .status,
    ).toBe(403);
    const res = await request(w.app)
      .post(`${api}/projects/${w.pid}/sprints`)
      .set(as(w.c.pm))
      .send(ok);
    expect(res.status).toBe(201);
    expect(res.body.sprint.status).toBe('PLANNED');
  });

  it('TC-SPR-001-2 an issue in another open sprint → 409 ISSUE_IN_OTHER_SPRINT; cross-project issues rejected', async () => {
    const w = await world();
    const a = await w.issue('A');
    await w.sprint('S1', [a.id]);
    const s2 = await w.sprint('S2');
    const res = await request(w.app)
      .put(`${api}/sprints/${s2.id}/issues`)
      .set(as(w.c.pm))
      .send({ add: [a.id] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ISSUE_IN_OTHER_SPRINT');
    const other = await db.project.create({
      data: { workspaceId: w.workspace.id, key: 'OTH', name: 'Other', createdById: w.u.owner.id },
    });
    const foreign = (
      await request(w.app)
        .post(`${api}/projects/${other.id}/issues`)
        .set(as(w.c.owner))
        .send({ type: 'TASK', title: 'F' })
    ).body.issue;
    expect(
      (
        await request(w.app)
          .put(`${api}/sprints/${s2.id}/issues`)
          .set(as(w.c.pm))
          .send({ add: [foreign.id] })
      ).status,
    ).toBe(422);
  });

  it('TC-SPR-002-1 two concurrent starts → exactly one ACTIVE, the other 409 ACTIVE_SPRINT_EXISTS', async () => {
    const w = await world();
    const [s1, s2] = [await w.sprint('S1'), await w.sprint('S2')];
    const results = await Promise.all(
      [s1, s2].map((s) => request(w.app).post(`${api}/sprints/${s.id}/start`).set(as(w.c.pm))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('ACTIVE_SPRINT_EXISTS');
    expect(await db.sprint.count({ where: { projectId: w.pid, status: 'ACTIVE' } })).toBe(1);
  });

  it('TC-SPR-003-1/006-2 committed points frozen at start; scope changes recorded; completedPoints at completion', async () => {
    const w = await world();
    const a = await w.issue('A', { storyPoints: 5 });
    const b = await w.issue('B', { storyPoints: 3 });
    const c = await w.issue('C');
    const s = await w.sprint('S1', [a.id, b.id, c.id]);
    await request(w.app).post(`${api}/sprints/${s.id}/start`).set(as(w.c.pm));
    const committed = await db.sprintIssueHistory.findMany({ where: { sprintId: s.id } });
    const pointsOf = (id: string) => committed.find((r) => r.issueId === id)?.committedPoints;
    // Unestimated C keeps a null snapshot so reports can list it; it counts as 0.
    expect([pointsOf(a.id), pointsOf(b.id), pointsOf(c.id)]).toEqual([5, 3, null]);
    expect(committed.every((r) => r.committedAt)).toBe(true);

    // Later estimate change does not alter the snapshot.
    const aNow = await db.issue.findUniqueOrThrow({ where: { id: a.id } });
    await request(w.app)
      .patch(`${api}/issues/${a.id}`)
      .set(as(w.c.pm))
      .send({ version: aNow.version, storyPoints: 8 });
    // Scope change mid-sprint: add D, remove B.
    const d = await w.issue('D', { storyPoints: 2 });
    await request(w.app)
      .put(`${api}/sprints/${s.id}/issues`)
      .set(as(w.c.pm))
      .send({ add: [d.id], remove: [b.id] });
    const dRow = await db.sprintIssueHistory.findFirstOrThrow({
      where: { sprintId: s.id, issueId: d.id },
    });
    expect(dRow.committedAt).toBeNull();
    expect(
      (await db.sprintIssueHistory.findFirstOrThrow({ where: { sprintId: s.id, issueId: b.id } }))
        .removedAt,
    ).not.toBeNull();

    const aFresh = await db.issue.findUniqueOrThrow({ where: { id: a.id } });
    await w.move(w.c.pm, a.id, { version: aFresh.version, status: 'DONE' });
    const done = await request(w.app)
      .post(`${api}/sprints/${s.id}/complete`)
      .set(as(w.c.pm))
      .send({ destination: { type: 'backlog' } });
    expect(done.status).toBe(200);
    const report = (
      await request(w.app).get(`${api}/sprints/${s.id}/report`).set('Cookie', w.c.member)
    ).body;
    expect(report).toMatchObject({
      committedIssues: 3,
      committedPoints: 8,
      unestimatedCommitted: 1,
      addedAfterStart: 1,
      removedDuringSprint: 1,
      completedIssues: 1,
      completedPoints: 8,
      carriedOver: 2,
    });

    // TC-SPR-005-1: the completed report does not drift when issues change later.
    const aLater = await db.issue.findUniqueOrThrow({ where: { id: a.id } });
    await request(w.app)
      .patch(`${api}/issues/${a.id}`)
      .set(as(w.c.pm))
      .send({ version: aLater.version, storyPoints: 1 });
    expect(
      (await request(w.app).get(`${api}/sprints/${s.id}/report`).set('Cookie', w.c.pm)).body
        .completedPoints,
    ).toBe(8);
  });

  it('TC-SPR-004-1 destination required (422); carry-over into a planned sprint writes correct history', async () => {
    const w = await world();
    const a = await w.issue('A');
    const b = await w.issue('B');
    const s1 = await w.sprint('S1', [a.id, b.id]);
    const next = await w.sprint('Next');
    await request(w.app).post(`${api}/sprints/${s1.id}/start`).set(as(w.c.pm));
    const missing = await request(w.app)
      .post(`${api}/sprints/${s1.id}/complete`)
      .set(as(w.c.pm))
      .send({});
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('DESTINATION_REQUIRED');
    const self = await request(w.app)
      .post(`${api}/sprints/${s1.id}/complete`)
      .set(as(w.c.pm))
      .send({ destination: { type: 'sprint', sprintId: s1.id } });
    expect(self.status).toBe(422);

    const bNow = await db.issue.findUniqueOrThrow({ where: { id: b.id } });
    await w.move(w.c.pm, b.id, { version: bNow.version, status: 'DONE' });
    const res = await request(w.app)
      .post(`${api}/sprints/${s1.id}/complete`)
      .set(as(w.c.pm))
      .send({ destination: { type: 'sprint', sprintId: next.id } });
    expect(res.status).toBe(200);
    expect(res.body.sprint.status).toBe('COMPLETED');
    expect((await db.issue.findUniqueOrThrow({ where: { id: a.id } })).sprintId).toBe(next.id);
    expect((await db.issue.findUniqueOrThrow({ where: { id: b.id } })).sprintId).toBe(s1.id); // done stays with history
    const old = await db.sprintIssueHistory.findFirstOrThrow({
      where: { sprintId: s1.id, issueId: a.id },
    });
    const carried = await db.sprintIssueHistory.findFirstOrThrow({
      where: { sprintId: next.id, issueId: a.id },
    });
    expect(old.removedAt?.getTime()).toBe(carried.addedAt.getTime());
    expect(
      (await db.sprintIssueHistory.findFirstOrThrow({ where: { sprintId: s1.id, issueId: b.id } }))
        .completedAt,
    ).not.toBeNull();
  });

  it('TC-SPR-006-1 edit rules per state; cancel PLANNED only; completed cannot be reopened or edited', async () => {
    const w = await world();
    const a = await w.issue('A', { status: 'IN_PROGRESS' });
    const planned = await w.sprint('Planned', [a.id]);
    const later = new Date(Date.now() + 20 * day).toISOString();
    expect(
      (
        await request(w.app)
          .patch(`${api}/sprints/${planned.id}`)
          .set(as(w.c.pm))
          .send({ startAt: new Date().toISOString(), goal: 'Ship' })
      ).status,
    ).toBe(200);
    const cancel = await request(w.app).post(`${api}/sprints/${planned.id}/cancel`).set(as(w.c.pm));
    expect(cancel.body.sprint.status).toBe('CANCELLED');
    const issue = await db.issue.findUniqueOrThrow({ where: { id: a.id } });
    expect(issue).toMatchObject({ sprintId: null, status: 'IN_PROGRESS' });
    expect(
      (
        await request(w.app)
          .patch(`${api}/sprints/${planned.id}`)
          .set(as(w.c.pm))
          .send({ name: 'x' })
      ).body.code,
    ).toBe('INVALID_SPRINT_STATE');

    const active = await w.sprint('Active');
    await request(w.app).post(`${api}/sprints/${active.id}/start`).set(as(w.c.pm));
    expect(
      (
        await request(w.app)
          .patch(`${api}/sprints/${active.id}`)
          .set(as(w.c.pm))
          .send({ startAt: new Date().toISOString() })
      ).body.code,
    ).toBe('INVALID_SPRINT_STATE');
    expect(
      (
        await request(w.app)
          .patch(`${api}/sprints/${active.id}`)
          .set(as(w.c.pm))
          .send({ endAt: later, name: 'Active v2' })
      ).status,
    ).toBe(200);
    expect(
      (await request(w.app).post(`${api}/sprints/${active.id}/cancel`).set(as(w.c.pm))).body.code,
    ).toBe('INVALID_SPRINT_STATE');
    await request(w.app)
      .post(`${api}/sprints/${active.id}/complete`)
      .set(as(w.c.pm))
      .send({ destination: { type: 'backlog' } });
    expect(
      (await request(w.app).post(`${api}/sprints/${active.id}/start`).set(as(w.c.pm))).body.code,
    ).toBe('INVALID_SPRINT_STATE');
    expect(
      (
        await request(w.app)
          .put(`${api}/sprints/${active.id}/issues`)
          .set(as(w.c.pm))
          .send({ add: [a.id] })
      ).body.code,
    ).toBe('INVALID_SPRINT_STATE');
  });

  it('sprint board shows only the active sprint; isolation and suspension guards', async () => {
    const w = await world();
    const inSprint = await w.issue('In sprint');
    await w.issue('Not in sprint');
    const s = await w.sprint('S', [inSprint.id]);
    expect(
      (await w.board(w.c.member, '?sprint=active')).columns.flatMap(
        (c: { issues: unknown[] }) => c.issues,
      ),
    ).toHaveLength(0);
    await request(w.app).post(`${api}/sprints/${s.id}/start`).set(as(w.c.pm));
    const b = await w.board(w.c.member, '?sprint=active');
    expect(b.sprint.name).toBe('S');
    expect(
      b.columns.flatMap((c: { issues: { title: string }[] }) => c.issues.map((i) => i.title)),
    ).toEqual(['In sprint']);

    const stranger = await createUser('s@x.test');
    const other = await createWorkspace('other-co', stranger.id);
    const sCookie = await signIn(w.app, stranger.email);
    expect((await request(w.app).get(`${api}/sprints/${s.id}`).set('Cookie', sCookie)).status).toBe(
      404,
    );
    expect(
      (await request(w.app).get(`${api}/sprints/${s.id}`).set('Cookie', w.c.outsider)).status,
    ).toBe(404);
    expect(
      (
        await request(w.app)
          .post(`${api}/sprints/${s.id}/complete`)
          .set(as(sCookie))
          .send({ destination: { type: 'backlog' } })
      ).status,
    ).toBe(404);
    expect(other).toBeDefined();

    await db.workspace.update({
      where: { id: w.workspace.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    const suspended = await request(w.app)
      .post(`${api}/sprints/${s.id}/complete`)
      .set(as(w.c.pm))
      .send({ destination: { type: 'backlog' } });
    expect(suspended.body.code).toBe('WORKSPACE_SUSPENDED');
  });
});
