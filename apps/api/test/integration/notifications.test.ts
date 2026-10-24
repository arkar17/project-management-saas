import type { OutboxEvent } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  claimBatch,
  OUTBOX_MAX_ATTEMPTS,
  processOutboxBatch,
} from '../../src/modules/notifications/outbox.processor.js';
import { runHourlyJobs } from '../../src/modules/notifications/scheduled-jobs.js';
import { buildApp, csrf, MemoryMailer, memoryLogger, ORIGIN } from '../helpers.js';
import { createUser, createWorkspace, db, signIn } from './setup.js';

const api = '/api/v1';
const as = (cookie: string) => csrf([cookie]);

/** Owner, a PM, two project Members, plus a second tenant. */
async function world() {
  const ctx = buildApp({ db });
  const { app } = ctx;
  const u = {
    owner: await createUser('owner@n.test'),
    pm: await createUser('pm@n.test'),
    member: await createUser('member@n.test'),
    member2: await createUser('member2@n.test'),
    rival: await createUser('rival@n.test'),
  };
  const { workspace, project } = await createWorkspace('notify-co', u.owner.id);
  await db.workspaceMember.createMany({
    data: [u.pm, u.member, u.member2].map((x) => ({
      workspaceId: workspace.id,
      userId: x.id,
      role: 'MEMBER' as const,
    })),
  });
  await db.projectMember.createMany({
    data: [
      { projectId: project.id, userId: u.pm.id, role: 'PROJECT_MANAGER' as const },
      { projectId: project.id, userId: u.member.id, role: 'MEMBER' as const },
      { projectId: project.id, userId: u.member2.id, role: 'MEMBER' as const },
    ],
  });
  await createWorkspace('rival-co', u.rival.id);
  const c = {
    owner: await signIn(app, u.owner.email),
    pm: await signIn(app, u.pm.email),
    member: await signIn(app, u.member.email),
    member2: await signIn(app, u.member2.email),
    rival: await signIn(app, u.rival.email),
  };
  const createIssueAs = async (cookie: string, body: Record<string, unknown>) =>
    (await request(app).post(`${api}/projects/${project.id}/issues`).set(as(cookie)).send(body))
      .body.issue as { id: string; version: number };
  const patch = async (cookie: string, iid: string, body: Record<string, unknown>) => {
    const { version } = await db.issue.findUniqueOrThrow({ where: { id: iid } });
    return request(app)
      .patch(`${api}/issues/${iid}`)
      .set(as(cookie))
      .send({ version, ...body });
  };
  const comment = (cookie: string, iid: string, body: string) =>
    request(app).post(`${api}/issues/${iid}/comments`).set(as(cookie)).send({ body });
  const list = (cookie: string, query = '') =>
    request(app).get(`${api}/notifications${query}`).set(as(cookie));
  const unread = async (cookie: string) =>
    (await request(app).get(`${api}/notifications/unread-count`).set(as(cookie))).body.unread;
  const notes = (userId: string) => db.notification.findMany({ where: { recipientId: userId } });
  return {
    ...ctx,
    wid: workspace.id,
    pid: project.id,
    u,
    c,
    createIssueAs,
    patch,
    comment,
    list,
    unread,
    notes,
  };
}

const enqueue = (topic: string, payload: object = {}) =>
  db.outboxEvent.create({ data: { topic, aggregateId: 'test', payload } });

describe('FR-NTF-001 / ADR-005 delivery', () => {
  it('TC-NTF-001-1 assignment, mention and watched updates are delivered once, never to the actor', async () => {
    const w = await world();
    const issue = await w.createIssueAs(w.c.pm, {
      type: 'TASK',
      title: 'Ship it',
      assigneeId: w.u.member.id,
    });
    await w.comment(w.c.pm, issue.id, `Please look @${w.u.member2.email}`);
    expect((await w.patch(w.c.member, issue.id, { status: 'IN_PROGRESS' })).status).toBe(200);

    // Nothing is delivered until the worker runs.
    expect(await db.notification.count()).toBe(0);
    await w.deliver();
    await w.deliver();

    const types = async (id: string) => (await w.notes(id)).map((n) => n.type).sort();
    // Assignee: ASSIGNED + watched update for the comment (auto-watch); own status change skipped.
    expect(await types(w.u.member.id)).toEqual(['ASSIGNED', 'WATCHED_ISSUE_UPDATED']);
    expect(await types(w.u.member2.id)).toEqual(['MENTIONED']);
    // Reporter (auto-watcher) hears about the Member's status change, not their own actions.
    const pmNotes = await w.notes(w.u.pm.id);
    expect(pmNotes.map((n) => n.type)).toEqual(['WATCHED_ISSUE_UPDATED']);
    expect(pmNotes[0]!.payload).toEqual({ actorId: w.u.member.id, fields: ['status'] });
    expect(await types(w.u.owner.id)).toEqual([]);

    // Re-processing an already delivered event (e.g. after a crash) inserts nothing new.
    const total = await db.notification.count();
    await db.outboxEvent.updateMany({ data: { status: 'PENDING', availableAt: new Date(0) } });
    await w.deliver();
    expect(await db.notification.count()).toBe(total);
  });

  it('reassignment notifies the new assignee as ASSIGNED, other watchers as updated', async () => {
    const w = await world();
    const issue = await w.createIssueAs(w.c.pm, { type: 'TASK', title: 'Move' });
    await w.patch(w.c.pm, issue.id, { assigneeId: w.u.member2.id });
    await w.deliver();
    expect((await w.notes(w.u.member2.id)).map((n) => n.type)).toEqual(['ASSIGNED']);
    expect(await w.notes(w.u.pm.id)).toHaveLength(0);
  });

  it('TC-NTF-001-1 invite acceptance notifies the inviter while they are Owner/Admin', async () => {
    const w = await world();
    const invitee = await createUser('new@n.test');
    await request(w.app)
      .post(`${api}/workspaces/${w.wid}/invitations`)
      .set(as(w.c.owner))
      .send({ email: invitee.email, role: 'MEMBER' });
    await w.deliver();
    const token = w.mailer.tokenFrom(w.mailer.last(invitee.email));
    const inviteeCookie = await signIn(w.app, invitee.email);
    const accepted = await request(w.app)
      .post(`${api}/invitations/accept`)
      .set(as(inviteeCookie))
      .send({ token });
    expect(accepted.status).toBe(200);
    await w.deliver();
    const [note] = await w.notes(w.u.owner.id);
    expect(note).toMatchObject({ type: 'INVITE_ACCEPTED', workspaceId: w.wid, projectId: null });
    const listed = (await w.list(w.c.owner)).body.notifications[0];
    expect(listed.actor).toEqual({ id: invitee.id, name: 'new' });
  });

  it('re-authorizes at delivery: revoked project access, removed members and deleted issues get nothing', async () => {
    const w = await world();
    const a = await w.createIssueAs(w.c.pm, {
      type: 'TASK',
      title: 'A',
      assigneeId: w.u.member.id,
    });
    const b = await w.createIssueAs(w.c.pm, {
      type: 'TASK',
      title: 'B',
      assigneeId: w.u.member2.id,
    });
    const d = await w.createIssueAs(w.c.pm, { type: 'TASK', title: 'D' });
    await w.patch(w.c.pm, d.id, { assigneeId: w.u.member.id });
    // Access changes after the event was written but before the worker runs.
    await db.projectMember.update({
      where: { projectId_userId: { projectId: w.pid, userId: w.u.member.id } },
      data: { status: 'REMOVED' },
    });
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.wid, userId: w.u.member2.id } },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    await db.issue.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    await w.deliver();
    expect(await w.notes(w.u.member.id)).toHaveLength(0);
    expect(await w.notes(w.u.member2.id)).toHaveLength(0);
    expect(a.id && b.id).toBeTruthy();
    // The events themselves are complete, not stuck for retry.
    expect(await db.outboxEvent.count({ where: { status: { not: 'PROCESSED' } } })).toBe(0);
  });
});

describe('ADR-005 outbox integrity, retries and concurrency', () => {
  it('outbox rows commit with their change only, and carry reference IDs only', async () => {
    const w = await world();
    const issue = await w.createIssueAs(w.c.pm, { type: 'TASK', title: 'Secretive' });
    const before = await db.outboxEvent.count();
    // A rejected change (stale version) writes no event.
    const stale = await request(w.app)
      .patch(`${api}/issues/${issue.id}`)
      .set(as(w.c.pm))
      .send({ version: 999, assigneeId: w.u.member.id });
    expect(stale.status).toBe(409);
    expect(await db.outboxEvent.count()).toBe(before);
    // A duplicate pending invitation (409) writes no second email event.
    const invite = () =>
      request(w.app)
        .post(`${api}/workspaces/${w.wid}/invitations`)
        .set(as(w.c.owner))
        .send({ email: 'dup@n.test', role: 'MEMBER' });
    expect((await invite()).status).toBe(201);
    expect((await invite()).status).toBe(409);
    expect(await db.outboxEvent.count({ where: { topic: 'email.invitation' } })).toBe(1);

    await w.comment(w.c.pm, issue.id, `top secret body @${w.u.member.email}`);
    await request(w.app)
      .post(`${api}/auth/forgot-password`)
      .set(csrf())
      .send({ email: w.u.pm.email });
    await w.deliver();
    const reset = w.mailer.tokenFrom(w.mailer.last(w.u.pm.email));
    const invited = w.mailer.tokenFrom(w.mailer.last('dup@n.test'));
    const payloads = JSON.stringify((await db.outboxEvent.findMany()).map((e) => e.payload));
    for (const secret of [reset, invited, 'top secret body', '@n.test']) {
      expect(payloads).not.toContain(secret);
    }
  });

  it('failures back off exponentially, redact lastError, and go DEAD after 8 attempts', async () => {
    const { logger, lines } = memoryLogger();
    const event = await enqueue('test.fail');
    const handlers = {
      'test.fail': async () => {
        throw new Error('SMTP rejected ada@example.com');
      },
    };
    const run = () =>
      processOutboxBatch({ db, mailer: new MemoryMailer(), logger, appBaseUrl: ORIGIN, handlers });

    const t0 = Date.now();
    expect(await run()).toEqual({ processed: 0, retried: 1, dead: 0 });
    let row = await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(row.lastError).toBe('Error: SMTP rejected [email]');
    expect(row.availableAt.getTime() - t0).toBeGreaterThanOrEqual(60_000 - 1000);
    // Not due yet: a second run does nothing.
    expect(await run()).toEqual({ processed: 0, retried: 0, dead: 0 });

    for (let i = 2; i <= OUTBOX_MAX_ATTEMPTS; i++) {
      await db.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date(0) } });
      await run();
    }
    row = await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row).toMatchObject({ status: 'DEAD', attempts: OUTBOX_MAX_ATTEMPTS });
    expect(lines.join('')).not.toContain('ada@example.com');
    expect(lines.some((l) => l.includes('"outbox.dead"'))).toBe(true);
  });

  it('a failed email send is retried and then delivered; unknown topics go DEAD', async () => {
    const w = await world();
    class FlakyMailer extends MemoryMailer {
      failures = 1;
      override async send(mail: Parameters<MemoryMailer['send']>[0]) {
        if (this.failures-- > 0) throw new Error('connection refused');
        await super.send(mail);
      }
    }
    const mailer = new FlakyMailer();
    await request(w.app)
      .post(`${api}/auth/forgot-password`)
      .set(csrf())
      .send({ email: w.u.pm.email });
    const unknown = await enqueue('nobody.handles.this');
    const run = () =>
      processOutboxBatch({ db, mailer, logger: memoryLogger().logger, appBaseUrl: ORIGIN });
    await run();
    expect(mailer.sent).toHaveLength(0);
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: unknown.id } })).status).toBe(
      'DEAD',
    );
    await db.outboxEvent.updateMany({
      where: { status: 'PENDING' },
      data: { availableAt: new Date(0) },
    });
    await run();
    // The link in the delivered email works.
    const token = mailer.tokenFrom(mailer.last(w.u.pm.email));
    const reset = await request(w.app)
      .post(`${api}/auth/reset-password`)
      .set(csrf())
      .send({ token, password: 'another-long-password' });
    expect(reset.status).toBe(204);
  });

  it('concurrent workers process every event exactly once', async () => {
    await db.outboxEvent.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        topic: 'test.count',
        aggregateId: String(i),
        payload: {},
      })),
    });
    const seen: string[] = [];
    const handlers = {
      'test.count': async (e: OutboxEvent) => {
        seen.push(e.id);
        await new Promise((r) => setTimeout(r, 2));
      },
    };
    const worker = async () => {
      let total = 0;
      for (;;) {
        const r = await processOutboxBatch({
          db,
          mailer: new MemoryMailer(),
          logger: memoryLogger().logger,
          appBaseUrl: ORIGIN,
          handlers,
          limit: 10,
        });
        total += r.processed;
        if (r.processed === 0) return total;
      }
    };
    const totals = await Promise.all([worker(), worker(), worker(), worker()]);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toHaveLength(120);
    expect(await db.outboxEvent.count({ where: { status: 'PROCESSED' } })).toBe(120);
  });

  it('a claimed event is leased, and becomes available again if its worker dies', async () => {
    const event = await enqueue('test.lease');
    expect((await claimBatch(db)).map((e) => e.id)).toEqual([event.id]);
    // A crashed worker never finishes; others do not take the event while the lease holds.
    expect(await claimBatch(db)).toHaveLength(0);
    await db.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date(0) } });
    expect((await claimBatch(db)).map((e) => e.id)).toEqual([event.id]);
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'PENDING',
    );
  });
});

describe('FR-NTF-002 notification inbox', () => {
  async function seeded() {
    const w = await world();
    for (const title of ['One', 'Two', 'Three']) {
      await w.createIssueAs(w.c.pm, { type: 'TASK', title, assigneeId: w.u.member.id });
    }
    await w.deliver();
    return w;
  }

  it('TC-NTF-002-1 read, unread, read-all and the badge count', async () => {
    const w = await seeded();
    expect(await w.unread(w.c.member)).toBe(3);
    const res = await w.list(w.c.member, '?pageSize=2');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    const [first] = res.body.notifications;
    expect(['One', 'Two', 'Three']).toContain(first.issue.title);
    expect(first).toMatchObject({
      type: 'ASSIGNED',
      actor: { id: w.u.pm.id, name: 'pm' },
      readAt: null,
    });

    const read = await request(w.app)
      .patch(`${api}/notifications/${first.id}/read`)
      .set(as(w.c.member));
    expect(read.status).toBe(204);
    expect(await w.unread(w.c.member)).toBe(2);
    expect((await w.list(w.c.member, '?unread=true')).body.total).toBe(2);
    await request(w.app).patch(`${api}/notifications/${first.id}/unread`).set(as(w.c.member));
    expect(await w.unread(w.c.member)).toBe(3);
    await request(w.app).post(`${api}/notifications/read-all`).set(as(w.c.member));
    expect(await w.unread(w.c.member)).toBe(0);
    expect((await w.list(w.c.member, '?pageSize=101')).status).toBe(422);
  });

  it('TC-NTF-002-2 notifications are hidden once access is revoked, and restored with it', async () => {
    const w = await seeded();
    const [note] = (await w.list(w.c.member)).body.notifications;
    await db.projectMember.update({
      where: { projectId_userId: { projectId: w.pid, userId: w.u.member.id } },
      data: { status: 'REMOVED' },
    });
    expect((await w.list(w.c.member)).body.total).toBe(0);
    expect(await w.unread(w.c.member)).toBe(0);
    expect(
      (await request(w.app).patch(`${api}/notifications/${note.id}/read`).set(as(w.c.member)))
        .status,
    ).toBe(404);

    await db.projectMember.update({
      where: { projectId_userId: { projectId: w.pid, userId: w.u.member.id } },
      data: { status: 'ACTIVE' },
    });
    expect(await w.unread(w.c.member)).toBe(3);
    // Removal from the workspace hides everything from that tenant.
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: w.wid, userId: w.u.member.id } },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    expect((await w.list(w.c.member)).body.total).toBe(0);
  });

  it('cross-tenant: another user cannot read, mark or count someone else’s notifications', async () => {
    const w = await seeded();
    const [note] = (await w.list(w.c.member)).body.notifications;
    expect((await w.list(w.c.rival)).body.total).toBe(0);
    expect(await w.unread(w.c.member2)).toBe(0);
    for (const path of [`${note.id}/read`, `${note.id}/unread`]) {
      expect(
        (await request(w.app).patch(`${api}/notifications/${path}`).set(as(w.c.rival))).status,
      ).toBe(404);
    }
    await request(w.app).post(`${api}/notifications/read-all`).set(as(w.c.rival));
    expect(await w.unread(w.c.member)).toBe(3);
    expect(
      (await request(w.app).patch(`${api}/notifications/not-a-uuid/read`).set(as(w.c.member)))
        .status,
    ).toBe(404);
    expect((await request(w.app).get(`${api}/notifications`)).status).toBe(401);
  });
});

describe('ADR-018 hourly invitation expiry', () => {
  it('expires PENDING invitations past expiresAt; expired invitations are never emailed', async () => {
    const w = await world();
    for (const email of ['late@n.test', 'fresh@n.test']) {
      await request(w.app)
        .post(`${api}/workspaces/${w.wid}/invitations`)
        .set(as(w.c.owner))
        .send({ email, role: 'MEMBER' });
    }
    await db.workspaceInvitation.updateMany({
      where: { email: 'late@n.test' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const { logger } = memoryLogger();
    expect(await runHourlyJobs(db, logger)).toEqual({ expiredInvitations: 1 });
    expect(
      (await db.workspaceInvitation.findMany({ orderBy: { email: 'asc' } })).map((i) => [
        i.email,
        i.state,
      ]),
    ).toEqual([
      ['fresh@n.test', 'PENDING'],
      ['late@n.test', 'EXPIRED'],
    ]);
    await w.deliver();
    expect(w.mailer.sent.map((m) => m.to)).toEqual(['fresh@n.test']);
    // Idempotent: a second run changes nothing.
    expect(await runHourlyJobs(db, logger)).toEqual({ expiredInvitations: 0 });
  });

  it('only one worker runs the hourly jobs at a time (advisory lock)', async () => {
    const { logger } = memoryLogger();
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4018001)`;
      expect(await runHourlyJobs(db, logger)).toBeNull();
    });
    expect(await runHourlyJobs(db, logger)).toEqual({ expiredInvitations: 0 });
  });
});
