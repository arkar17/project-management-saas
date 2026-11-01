import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp, csrf } from '../helpers.js';
import { createUser, createWorkspace, db, signIn } from './setup.js';

const api = '/api/v1';
const as = (cookie: string) => csrf([cookie]);

/** Owner, a PM, two project Members and a workspace member without project access. */
async function world() {
  const { app } = buildApp({ db });
  const u = {
    owner: await createUser('owner@i.test'),
    pm: await createUser('pm@i.test'),
    member: await createUser('member@i.test'),
    member2: await createUser('member2@i.test'),
    outsider: await createUser('outsider@i.test'),
  };
  const { workspace, project } = await createWorkspace('issue-co', u.owner.id);
  const wid = workspace.id;
  const pid = project.id;
  await db.workspaceMember.createMany({
    data: [u.pm, u.member, u.member2, u.outsider].map((x) => ({
      workspaceId: wid,
      userId: x.id,
      role: 'MEMBER' as const,
    })),
  });
  await db.projectMember.createMany({
    data: [
      { projectId: pid, userId: u.pm.id, role: 'PROJECT_MANAGER' as const },
      { projectId: pid, userId: u.member.id, role: 'MEMBER' as const },
      { projectId: pid, userId: u.member2.id, role: 'MEMBER' as const },
    ],
  });
  const c = {
    owner: await signIn(app, u.owner.email),
    pm: await signIn(app, u.pm.email),
    member: await signIn(app, u.member.email),
    member2: await signIn(app, u.member2.email),
    outsider: await signIn(app, u.outsider.email),
  };
  const create = (cookie: string, body: Record<string, unknown>) =>
    request(app).post(`${api}/projects/${pid}/issues`).set(as(cookie)).send(body);
  const patch = (cookie: string, iid: string, body: Record<string, unknown>) =>
    request(app).patch(`${api}/issues/${iid}`).set(as(cookie)).send(body);
  return { app, wid, pid, project, u, c, create, patch };
}

describe('FR-ISS-001/002 creation', () => {
  it('TC-ISS-001-1 all five types creatable with sequential immutable keys; defaults applied', async () => {
    const w = await world();
    const epic = await w.create(w.c.pm, { type: 'EPIC', title: 'Epic' });
    const story = await w.create(w.c.pm, {
      type: 'STORY',
      title: 'Story',
      parentId: epic.body.issue.id,
    });
    const task = await w.create(w.c.pm, { type: 'TASK', title: 'Task' });
    const bug = await w.create(w.c.pm, { type: 'BUG', title: 'Bug', parentId: epic.body.issue.id });
    const sub = await w.create(w.c.pm, {
      type: 'SUBTASK',
      title: 'Sub',
      parentId: story.body.issue.id,
    });
    const keys = [epic, story, task, bug, sub].map((r) => {
      expect(r.status).toBe(201);
      return r.body.issue.key;
    });
    expect(keys).toEqual(['ISSU-1', 'ISSU-2', 'ISSU-3', 'ISSU-4', 'ISSU-5']);
    expect(task.body.issue).toMatchObject({
      priority: 'MEDIUM',
      status: 'BACKLOG',
      version: 1,
      assignee: null,
    });
    const res = await w.patch(w.c.pm, task.body.issue.id, { version: 1, key: 'OTHER-1' });
    expect(res.status).toBe(422);
  });

  it('concurrent creation allocates unique, gap-free numbers', async () => {
    const w = await world();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => w.create(w.c.pm, { type: 'TASK', title: `T${i}` })),
    );
    const numbers = results.map((r) => r.body.issue.number).sort((a: number, b: number) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(results.map((r) => r.body.issue.rank)).size).toBe(8);
  });

  it('TC-ISS-001-2 projectId in PATCH is rejected for every role', async () => {
    const w = await world();
    const other = await db.project.create({
      data: { workspaceId: w.wid, key: 'OTH', name: 'Other', createdById: w.u.owner.id },
    });
    const issue = (await w.create(w.c.member, { type: 'TASK', title: 'Mine' })).body.issue;
    for (const cookie of [w.c.owner, w.c.pm, w.c.member]) {
      expect((await w.patch(cookie, issue.id, { version: 1, projectId: other.id })).status).toBe(
        422,
      );
    }
    expect((await db.issue.findUniqueOrThrow({ where: { id: issue.id } })).projectId).toBe(w.pid);
  });

  it('TC-ISS-002-1 description sanitised server-side; story points bounded', async () => {
    const w = await world();
    const res = await w.create(w.c.pm, {
      type: 'TASK',
      title: 'XSS',
      description: 'ok <script>x()</script>[a](javascript:alert(1))',
    });
    expect(res.body.issue.description).toBe('ok x()[a](#)');
    expect((await w.create(w.c.pm, { type: 'TASK', title: 'P', storyPoints: 101 })).status).toBe(
      422,
    );
    expect(
      (await w.create(w.c.pm, { type: 'TASK', title: 'P', storyPoints: 13 })).body.issue
        .storyPoints,
    ).toBe(13);
  });
});

describe('FR-ISS-003 list', () => {
  it('TC-ISS-003-1 filters, search and bounded pagination; deleted hidden', async () => {
    const w = await world();
    await w.create(w.c.pm, {
      type: 'BUG',
      title: 'Login crash',
      priority: 'HIGH',
      assigneeId: w.u.member.id,
    });
    await w.create(w.c.pm, { type: 'TASK', title: 'Write docs' });
    const gone = (await w.create(w.c.pm, { type: 'TASK', title: 'Gone' })).body.issue;
    await request(w.app).delete(`${api}/issues/${gone.id}`).set(as(w.c.pm));
    const list = (q: string, cookie = w.c.member) =>
      request(w.app).get(`${api}/projects/${w.pid}/issues${q}`).set('Cookie', cookie);

    expect((await list('')).body.total).toBe(2);
    expect((await list('?type=BUG')).body.issues.map((i: { title: string }) => i.title)).toEqual([
      'Login crash',
    ]);
    expect((await list('?priority=HIGH,LOW')).body.total).toBe(1);
    expect((await list('?assignee=me')).body.total).toBe(1);
    expect((await list('?assignee=none')).body.total).toBe(1);
    expect((await list('?search=docs')).body.total).toBe(1);
    expect((await list('?search=ISSU-1')).body.total).toBe(1);
    expect((await list('?pageSize=1&page=2')).body.issues).toHaveLength(1);
    expect((await list('?pageSize=101')).status).toBe(422);
    expect((await list('?deleted=true')).status).toBe(403);
    expect(
      (await list('?deleted=true', w.c.pm)).body.issues.map((i: { title: string }) => i.title),
    ).toEqual(['Gone']);
    expect((await list('', w.c.outsider)).status).toBe(404);
  });
});

describe('FR-ISS-004 hierarchy', () => {
  it('TC-ISS-004-2 cross-project parent rejected (422); invalid pairings rejected; type change keeps children valid', async () => {
    const w = await world();
    const other = await db.project.create({
      data: { workspaceId: w.wid, key: 'OTH', name: 'Other', createdById: w.u.owner.id },
    });
    const foreign = await request(w.app)
      .post(`${api}/projects/${other.id}/issues`)
      .set(as(w.c.owner))
      .send({ type: 'STORY', title: 'Foreign' });
    const res = await w.create(w.c.pm, {
      type: 'SUBTASK',
      title: 'Sub',
      parentId: foreign.body.issue.id,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_HIERARCHY');

    expect((await w.create(w.c.pm, { type: 'SUBTASK', title: 'Orphan' })).status).toBe(422);
    const bug = (await w.create(w.c.pm, { type: 'BUG', title: 'Bug' })).body.issue;
    expect((await w.create(w.c.pm, { type: 'SUBTASK', title: 'S', parentId: bug.id })).status).toBe(
      422,
    );
    const story = (await w.create(w.c.pm, { type: 'STORY', title: 'Story' })).body.issue;
    await w.create(w.c.pm, { type: 'SUBTASK', title: 'S', parentId: story.id });
    const toBug = await w.patch(w.c.pm, story.id, { version: 1, type: 'BUG' });
    expect(toBug.status).toBe(422);
    expect((await w.patch(w.c.pm, story.id, { version: 1, type: 'TASK' })).status).toBe(200);
    const children = await request(w.app)
      .get(`${api}/issues/${story.id}/children`)
      .set('Cookie', w.c.member);
    expect(children.body.issues).toHaveLength(1);
  });
});

describe('ADR-008 field-level permissions', () => {
  it('Members edit title/description/dueAt/status of own issues only; any other field → 403 for the whole request', async () => {
    const w = await world();
    const own = (await w.create(w.c.member, { type: 'TASK', title: 'Mine' })).body.issue;
    const others = (await w.create(w.c.pm, { type: 'TASK', title: 'PM issue' })).body.issue;

    const ok = await w.patch(w.c.member, own.id, {
      version: 1,
      title: 'Mine v2',
      status: 'IN_PROGRESS',
      dueAt: '2026-11-30T00:00:00Z',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.issue).toMatchObject({ title: 'Mine v2', status: 'IN_PROGRESS', version: 2 });

    const mixed = await w.patch(w.c.member, own.id, { version: 2, title: 'x', priority: 'HIGH' });
    expect(mixed.status).toBe(403);
    expect(mixed.body).toMatchObject({
      code: 'FIELD_FORBIDDEN',
      details: { fields: ['priority'] },
    });
    expect((await db.issue.findUniqueOrThrow({ where: { id: own.id } })).title).toBe('Mine v2');

    const notOwn = await w.patch(w.c.member, others.id, { version: 1, title: 'Hijack' });
    expect(notOwn.body.code).toBe('FIELD_FORBIDDEN');
    expect(
      (await w.patch(w.c.pm, others.id, { version: 1, priority: 'HIGH', storyPoints: 5 })).status,
    ).toBe(200);
  });

  it('a status change appends the issue to the end of the target column', async () => {
    const w = await world();
    const a = (await w.create(w.c.pm, { type: 'TASK', title: 'A', status: 'TO_DO' })).body.issue;
    const b = (await w.create(w.c.pm, { type: 'TASK', title: 'B', status: 'TO_DO' })).body.issue;
    const mine = (await w.create(w.c.member, { type: 'TASK', title: 'C' })).body.issue;
    const moved = await w.patch(w.c.member, mine.id, { version: 1, status: 'TO_DO' });
    expect(moved.body.issue.rank > b.rank && b.rank > a.rank).toBe(true);
  });

  it('TC-ISS-008-1 stale version → 409 VERSION_CONFLICT', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T' })).body.issue;
    expect((await w.patch(w.c.pm, issue.id, { version: 1, title: 'first' })).status).toBe(200);
    const stale = await w.patch(w.c.owner, issue.id, { version: 1, title: 'second' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    // Concurrent edits from the same version: exactly one wins.
    const both = await Promise.all([
      w.patch(w.c.pm, issue.id, { version: 2, title: 'x' }),
      w.patch(w.c.owner, issue.id, { version: 2, title: 'y' }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('FR-ISS-009 assignee eligibility', () => {
  it('TC-ISS-009-1 assignee without project access → 422; Owner/Admin are eligible', async () => {
    const w = await world();
    const res = await w.create(w.c.pm, { type: 'TASK', title: 'T', assigneeId: w.u.outsider.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ASSIGNEE_NOT_ELIGIBLE');
    expect(
      (await w.create(w.c.pm, { type: 'TASK', title: 'T', assigneeId: w.u.owner.id })).status,
    ).toBe(201);
    const stranger = await createUser('stranger@x.test');
    expect(
      (await w.create(w.c.pm, { type: 'TASK', title: 'T', assigneeId: stranger.id })).status,
    ).toBe(422);
  });

  it('TC-ISS-009-2 Member create: assignee self or none only; no priority/points', async () => {
    const w = await world();
    expect(
      (await w.create(w.c.member, { type: 'TASK', title: 'T', assigneeId: w.u.member.id })).status,
    ).toBe(201);
    expect((await w.create(w.c.member, { type: 'TASK', title: 'T' })).status).toBe(201);
    const other = await w.create(w.c.member, {
      type: 'TASK',
      title: 'T',
      assigneeId: w.u.member2.id,
    });
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('FIELD_FORBIDDEN');
    expect(
      (await w.create(w.c.member, { type: 'TASK', title: 'T', priority: 'HIGH' })).status,
    ).toBe(403);
    expect((await w.create(w.c.outsider, { type: 'TASK', title: 'T' })).status).toBe(404);
  });
});

describe('FR-ISS-005 labels and comments', () => {
  it('TC-ISS-005-1 label CRUD is PM+; names unique per project; delete cascades IssueLabel', async () => {
    const w = await world();
    const url = `${api}/projects/${w.pid}/labels`;
    expect(
      (await request(w.app).post(url).set(as(w.c.member)).send({ name: 'bug', color: '#ff0000' }))
        .status,
    ).toBe(403);
    const label = (
      await request(w.app).post(url).set(as(w.c.pm)).send({ name: 'frontend', color: '#4f46e5' })
    ).body.label;
    expect(
      (await request(w.app).post(url).set(as(w.c.pm)).send({ name: 'frontend', color: '#000000' }))
        .body.code,
    ).toBe('LABEL_TAKEN');
    const issue = (await w.create(w.c.member, { type: 'TASK', title: 'T', labelIds: [label.id] }))
      .body.issue;
    expect(issue.labels.map((l: { name: string }) => l.name)).toEqual(['frontend']);
    // Members cannot change labels after creation.
    expect(
      (
        await request(w.app)
          .put(`${api}/issues/${issue.id}/labels`)
          .set(as(w.c.member))
          .send({ labelIds: [] })
      ).status,
    ).toBe(403);
    expect(
      (await request(w.app).patch(`${api}/labels/${label.id}`).set(as(w.c.pm)).send({ name: 'ui' }))
        .body.label.name,
    ).toBe('ui');
    expect((await request(w.app).delete(`${api}/labels/${label.id}`).set(as(w.c.pm))).status).toBe(
      204,
    );
    expect(await db.issueLabel.count()).toBe(0);
    // Labels from another project are rejected.
    const other = await db.project.create({
      data: { workspaceId: w.wid, key: 'OTH', name: 'O', createdById: w.u.owner.id },
    });
    const foreign = await db.label.create({
      data: { projectId: other.id, name: 'x', color: '#000000' },
    });
    expect(
      (await w.create(w.c.pm, { type: 'TASK', title: 'T', labelIds: [foreign.id] })).status,
    ).toBe(422);
  });

  it('TC-ISS-005-2 comment edit after 15 min → 403; authors delete their own; others cannot', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T' })).body.issue;
    const post = await request(w.app)
      .post(`${api}/issues/${issue.id}/comments`)
      .set(as(w.c.member))
      .send({ body: 'first' });
    expect(post.status).toBe(201);
    const cid = post.body.comment.id;
    expect(
      (
        await request(w.app)
          .patch(`${api}/comments/${cid}`)
          .set(as(w.c.member))
          .send({ body: 'edited' })
      ).body.comment.editedAt,
    ).not.toBeNull();
    expect(
      (
        await request(w.app)
          .patch(`${api}/comments/${cid}`)
          .set(as(w.c.member2))
          .send({ body: 'nope' })
      ).status,
    ).toBe(403);
    await db.issueComment.update({
      where: { id: cid },
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    const late = await request(w.app)
      .patch(`${api}/comments/${cid}`)
      .set(as(w.c.member))
      .send({ body: 'late' });
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('COMMENT_EDIT_WINDOW_CLOSED');
    expect((await request(w.app).delete(`${api}/comments/${cid}`).set(as(w.c.pm))).status).toBe(
      403,
    );
    expect((await request(w.app).delete(`${api}/comments/${cid}`).set(as(w.c.member))).status).toBe(
      204,
    );
  });

  it('TC-ISS-005-3 moderation requires a reason, is audited, and the body is never returned', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T' })).body.issue;
    const cid = (
      await request(w.app)
        .post(`${api}/issues/${issue.id}/comments`)
        .set(as(w.c.member))
        .send({ body: 'secret rant' })
    ).body.comment.id;
    const url = `${api}/comments/${cid}/moderate`;
    expect((await request(w.app).post(url).set(as(w.c.pm)).send({ reason: '' })).status).toBe(422);
    expect((await request(w.app).post(url).set(as(w.c.member2)).send({ reason: 'x' })).status).toBe(
      403,
    );
    expect(
      (await request(w.app).post(url).set(as(w.c.pm)).send({ reason: 'Off-topic' })).status,
    ).toBe(204);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'comment.moderated' } });
    expect(audit.metadata).toMatchObject({ reason: 'Off-topic' });
    const list = await request(w.app)
      .get(`${api}/issues/${issue.id}/comments`)
      .set('Cookie', w.c.owner);
    expect(list.body.comments[0]).toMatchObject({ removed: true, moderated: true, body: null });
    expect(JSON.stringify(list.body)).not.toContain('secret rant');
  });

  it('TC-ISS-005-4 mentions of users who cannot view the issue produce no notification recipient', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T' })).body.issue;
    await request(w.app)
      .post(`${api}/issues/${issue.id}/comments`)
      .set(as(w.c.pm))
      .send({ body: 'cc @member@i.test @outsider@i.test @owner@i.test @pm@i.test @ghost@i.test' });
    const event = await db.outboxEvent.findFirstOrThrow({ where: { topic: 'issue.commented' } });
    const ids = (event.payload as { mentionedUserIds: string[] }).mentionedUserIds.sort();
    expect(ids).toEqual([w.u.member.id, w.u.owner.id].sort()); // not the outsider, ghost or author
  });
});

describe('FR-ISS-007 soft delete', () => {
  it('TC-ISS-007-1/2 soft delete hides from Members (404), leaves the open sprint; restore by PM+ only', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T' })).body.issue;
    const sprint = await db.sprint.create({
      data: {
        projectId: w.pid,
        name: 'S1',
        startAt: new Date(),
        endAt: new Date(Date.now() + 86_400_000),
        status: 'ACTIVE',
      },
    });
    await db.issue.update({ where: { id: issue.id }, data: { sprintId: sprint.id } });
    await db.sprintIssueHistory.create({
      data: { sprintId: sprint.id, issueId: issue.id, projectId: w.pid },
    });

    expect(
      (await request(w.app).delete(`${api}/issues/${issue.id}`).set(as(w.c.member))).status,
    ).toBe(403);
    expect((await request(w.app).delete(`${api}/issues/${issue.id}`).set(as(w.c.pm))).status).toBe(
      204,
    );
    const row = await db.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(row).toMatchObject({ sprintId: null, deletedById: w.u.pm.id });
    expect(
      (await db.sprintIssueHistory.findFirstOrThrow({ where: { issueId: issue.id } })).removedAt,
    ).not.toBeNull();

    expect(
      (await request(w.app).get(`${api}/issues/${issue.id}`).set('Cookie', w.c.member)).status,
    ).toBe(404);
    expect(
      (await request(w.app).post(`${api}/issues/${issue.id}/restore`).set(as(w.c.member))).status,
    ).toBe(404);
    const restored = await request(w.app)
      .post(`${api}/issues/${issue.id}/restore`)
      .set(as(w.c.owner));
    expect(restored.status).toBe(200);
    expect(restored.body.issue).toMatchObject({ deletedAt: null, sprintId: null });
    const fields = (
      await request(w.app).get(`${api}/issues/${issue.id}/activity`).set('Cookie', w.c.member)
    ).body.activity.map((a: { field: string }) => a.field);
    expect(fields).toEqual(['restored', 'deleted', 'created']);
  });
});

describe('FR-ISS-010 watchers and activity', () => {
  it('TC-ISS-010-1 reporter and assignee auto-watch; watching requires view access', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T', assigneeId: w.u.member.id }))
      .body.issue;
    const watchers = await request(w.app)
      .get(`${api}/issues/${issue.id}/watchers`)
      .set('Cookie', w.c.member);
    expect(watchers.body.watchers.map((x: { id: string }) => x.id).sort()).toEqual(
      [w.u.pm.id, w.u.member.id].sort(),
    );
    expect(watchers.body.watching).toBe(true);
    const join = await request(w.app).post(`${api}/issues/${issue.id}/watch`).set(as(w.c.member2));
    expect(join.body).toMatchObject({ watching: true });
    expect(
      (await request(w.app).post(`${api}/issues/${issue.id}/watch`).set(as(w.c.member2))).status,
    ).toBe(200); // idempotent
    expect(
      (await request(w.app).post(`${api}/issues/${issue.id}/watch`).set(as(w.c.outsider))).status,
    ).toBe(404);
    expect(
      (await request(w.app).delete(`${api}/issues/${issue.id}/watch`).set(as(w.c.member2))).body
        .watching,
    ).toBe(false);
    // Reassignment auto-watches the new assignee and is recorded in activity.
    await w.patch(w.c.pm, issue.id, { version: 1, assigneeId: w.u.member2.id });
    expect(
      await db.issueWatcher.count({ where: { issueId: issue.id, userId: w.u.member2.id } }),
    ).toBe(1);
    const activity = (
      await request(w.app).get(`${api}/issues/${issue.id}/activity`).set('Cookie', w.c.pm)
    ).body.activity;
    expect(activity[0]).toMatchObject({
      field: 'assigneeId',
      oldValue: w.u.member.id,
      newValue: w.u.member2.id,
    });
    expect(await db.outboxEvent.count({ where: { topic: 'issue.updated' } })).toBe(1);
  });

  it('TC-ISS-010-2 watch rows are removed when project access is revoked', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T' })).body.issue;
    await request(w.app).post(`${api}/issues/${issue.id}/watch`).set(as(w.c.member2));
    const row = await db.projectMember.findFirstOrThrow({ where: { userId: w.u.member2.id } });
    await request(w.app).delete(`${api}/projects/${w.pid}/members/${row.id}`).set(as(w.c.pm));
    expect(await db.issueWatcher.count({ where: { userId: w.u.member2.id } })).toBe(0);
  });
});

describe('archived and cross-workspace guards', () => {
  it('archived project: every issue mutation → 409 PROJECT_ARCHIVED; reads still work', async () => {
    const w = await world();
    const issue = (await w.create(w.c.pm, { type: 'TASK', title: 'T' })).body.issue;
    await request(w.app).post(`${api}/projects/${w.pid}/archive`).set(as(w.c.owner));
    const results = await Promise.all([
      w.create(w.c.pm, { type: 'TASK', title: 'New' }),
      w.patch(w.c.pm, issue.id, { version: 1, title: 'x' }),
      request(w.app).post(`${api}/issues/${issue.id}/comments`).set(as(w.c.pm)).send({ body: 'x' }),
      request(w.app).delete(`${api}/issues/${issue.id}`).set(as(w.c.pm)),
      request(w.app).post(`${api}/issues/${issue.id}/watch`).set(as(w.c.member)),
      request(w.app)
        .post(`${api}/projects/${w.pid}/labels`)
        .set(as(w.c.pm))
        .send({ name: 'x', color: '#000000' }),
    ]);
    for (const r of results) expect(r.body.code).toBe('PROJECT_ARCHIVED');
    expect(
      (await request(w.app).get(`${api}/issues/${issue.id}`).set('Cookie', w.c.member)).status,
    ).toBe(200);
  });

  it('issue, comment and label ids from another workspace are 404', async () => {
    const w = await world();
    const stranger = await createUser('s@x.test');
    const other = await createWorkspace('other-co', stranger.id);
    const sCookie = await signIn(w.app, stranger.email);
    const foreign = (
      await request(w.app)
        .post(`${api}/projects/${other.project.id}/issues`)
        .set(as(sCookie))
        .send({ type: 'TASK', title: 'F' })
    ).body.issue;
    const comment = (
      await request(w.app)
        .post(`${api}/issues/${foreign.id}/comments`)
        .set(as(sCookie))
        .send({ body: 'hi' })
    ).body.comment;
    const label = (
      await request(w.app)
        .post(`${api}/projects/${other.project.id}/labels`)
        .set(as(sCookie))
        .send({ name: 'l', color: '#000000' })
    ).body.label;
    expect(
      (await request(w.app).get(`${api}/issues/${foreign.id}`).set('Cookie', w.c.owner)).status,
    ).toBe(404);
    expect(
      (await request(w.app).get(`${api}/issues/${foreign.id}/comments`).set('Cookie', w.c.owner))
        .status,
    ).toBe(404);
    expect(
      (
        await request(w.app)
          .patch(`${api}/comments/${comment.id}`)
          .set(as(w.c.owner))
          .send({ body: 'x' })
      ).status,
    ).toBe(404);
    expect(
      (await request(w.app).delete(`${api}/labels/${label.id}`).set(as(w.c.owner))).status,
    ).toBe(404);
    expect(
      (await request(w.app).get(`${api}/issues/not-a-uuid`).set('Cookie', w.c.owner)).status,
    ).toBe(404);
  });
});
