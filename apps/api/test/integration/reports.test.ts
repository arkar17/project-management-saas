import { addDays, localDate } from '@pm/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { runHourlyJobs } from '../../src/modules/notifications/scheduled-jobs.js';
import { writeSprintMetrics } from '../../src/modules/reports/sprint-metrics.js';
import { buildApp, csrf, memoryLogger } from '../helpers.js';
import { createIssue, createUser, createWorkspace, db, signIn } from './setup.js';

const api = '/api/v1';
const as = (cookie: string) => csrf([cookie]);
const DAY = 24 * 60 * 60 * 1000;

/** Owner, a PM, a Member, a workspace member without project access, and a rival tenant. */
async function world(timezone = 'UTC') {
  const { app } = buildApp({ db });
  const u = {
    owner: await createUser('owner@r.test'),
    pm: await createUser('pm@r.test'),
    member: await createUser('member@r.test'),
    outsider: await createUser('outsider@r.test'),
    rival: await createUser('rival@r.test'),
  };
  const { workspace, project } = await createWorkspace('report-co', u.owner.id);
  await db.workspace.update({ where: { id: workspace.id }, data: { timezone } });
  const other = await db.project.create({
    data: { workspaceId: workspace.id, key: 'OTH', name: 'Other', createdById: u.owner.id },
  });
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
  const rival = await createWorkspace('rival-co', u.rival.id);
  const c = Object.fromEntries(
    await Promise.all(Object.entries(u).map(async ([k, v]) => [k, await signIn(app, v.email)])),
  ) as Record<keyof typeof u, string>;
  const get = (cookie: string, path: string) => request(app).get(`${api}${path}`).set(as(cookie));
  const issue = (extra: Parameters<typeof createIssue>[3] & Record<string, unknown> = {}) => {
    const { storyPoints, status, dueAt, ...rest } = extra as Record<string, never>;
    return createIssue(workspace.id, project.id, u.pm.id, rest).then((i) =>
      db.issue.update({ where: { id: i.id }, data: { storyPoints, status, dueAt } }),
    );
  };
  return { app, wid: workspace.id, pid: project.id, other, rival, u, c, get, issue };
}

/**
 * A sprint that started `daysAgo` local days ago with the given committed issues, built
 * directly as history fixtures (the API cannot back-date a start).
 */
async function startedSprint(
  w: Awaited<ReturnType<typeof world>>,
  daysAgo: number,
  committed: { id: string; storyPoints: number | null }[],
) {
  const startedAt = new Date(Date.now() - daysAgo * DAY);
  const sprint = await db.sprint.create({
    data: {
      projectId: w.pid,
      name: `S-${daysAgo}`,
      startAt: startedAt,
      endAt: new Date(Date.now() + 3 * DAY),
      status: 'ACTIVE',
      startedAt,
    },
  });
  for (const i of committed) {
    await db.issue.update({ where: { id: i.id }, data: { sprintId: sprint.id } });
    await db.sprintIssueHistory.create({
      data: {
        sprintId: sprint.id,
        issueId: i.id,
        projectId: w.pid,
        addedAt: new Date(startedAt.getTime() - 1000),
        committedAt: startedAt,
        committedPoints: i.storyPoints,
      },
    });
  }
  return sprint;
}

describe('FR-RPT-001 workspace overview', () => {
  it('TC-RPT-001-1 aggregates only authorised, non-archived projects and states the timezone', async () => {
    const w = await world();
    const yesterday = new Date(Date.now() - DAY);
    const soon = new Date(Date.now() + 2 * DAY);
    await w.issue({ status: 'DONE' });
    await w.issue({ dueAt: yesterday }); // overdue
    await w.issue({ dueAt: yesterday, status: 'DONE' }); // done: not overdue
    await w.issue({ dueAt: soon }); // upcoming
    await w.issue({ deletedAt: new Date(), dueAt: yesterday }); // deleted: ignored
    await createIssue(w.wid, w.other.id, w.u.owner.id); // other project: Member cannot see it
    const archived = await db.project.create({
      data: {
        workspaceId: w.wid,
        key: 'ARC',
        name: 'Archived',
        createdById: w.u.owner.id,
        archivedAt: new Date(),
        archivedById: w.u.owner.id,
      },
    });
    await createIssue(w.wid, archived.id, w.u.owner.id);
    await createIssue(w.rival.workspace.id, w.rival.project.id, w.u.rival.id);

    const owner = (await w.get(w.c.owner, `/workspaces/${w.wid}/overview`)).body;
    expect(owner.range).toMatchObject({ timezone: 'UTC' });
    expect(owner.totals).toEqual({
      projects: 2,
      issues: 5,
      open: 3,
      done: 2,
      overdue: 1,
      upcoming: 1,
    });
    expect(owner.projects.map((p: { key: string }) => p.key).sort()).toEqual(['OTH', 'REPO']);

    const member = (await w.get(w.c.member, `/workspaces/${w.wid}/overview`)).body;
    expect(member.totals).toMatchObject({ projects: 1, issues: 4, overdue: 1, upcoming: 1 });
    expect(member.upcoming).toHaveLength(1);
    expect(member.upcoming[0]).toMatchObject({ projectId: w.pid });

    // No project access: summary is empty, not leaked.
    const outsider = (await w.get(w.c.outsider, `/workspaces/${w.wid}/overview`)).body;
    expect(outsider.totals).toMatchObject({ projects: 0, issues: 0 });
    expect((await w.get(w.c.rival, `/workspaces/${w.wid}/overview`)).status).toBe(404);
  });

  it('TC-RPT-006-1 overdue follows the workspace timezone day', async () => {
    const w = await world('UTC');
    // One minute before UTC midnight: "yesterday" in UTC, a different local day elsewhere.
    const due = new Date(Date.parse(`${localDate(new Date(), 'UTC')}T00:00:00Z`) - 60_000);
    await w.issue({ dueAt: due });
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      await db.workspace.update({ where: { id: w.wid }, data: { timezone: tz } });
      const o = (await w.get(w.c.owner, `/workspaces/${w.wid}/overview`)).body;
      const expected = localDate(due, tz) < localDate(new Date(), tz) ? 1 : 0;
      expect(o.range).toMatchObject({ timezone: tz, from: localDate(new Date(), tz) });
      expect([tz, o.totals.overdue]).toEqual([tz, expected]);
    }
  });
});

describe('FR-RPT-002/005 project reports', () => {
  it('project overview adds type/priority counts and the range; non-members get 404', async () => {
    const w = await world();
    await w.issue({ status: 'DONE' });
    await w.issue({});
    const res = await w.get(w.c.member, `/projects/${w.pid}/reports/overview`);
    expect(res.status).toBe(200);
    expect(res.body.overview).toMatchObject({
      totalIssues: 2,
      progressPercent: 50,
      byType: { TASK: 2 },
      byPriority: { MEDIUM: 2 },
      range: { timezone: 'UTC' },
    });
    for (const path of ['overview', 'velocity', 'workload']) {
      expect((await w.get(w.c.outsider, `/projects/${w.pid}/reports/${path}`)).status).toBe(404);
      expect((await w.get(w.c.rival, `/projects/${w.pid}/reports/${path}`)).status).toBe(404);
    }
    expect((await request(w.app).get(`${api}/projects/${w.pid}/reports/workload`)).status).toBe(
      401,
    );
  });

  it('TC-RPT-005-1 workload counts open issues by assignee, unassigned and unestimated', async () => {
    const w = await world();
    await w.issue({ assigneeId: w.u.member.id, storyPoints: 5 });
    await w.issue({ assigneeId: w.u.member.id, storyPoints: null }); // unestimated
    await w.issue({ assigneeId: w.u.member.id, storyPoints: 0 }); // estimated at zero
    await w.issue({ assigneeId: w.u.member.id, storyPoints: 8, status: 'DONE' }); // done: excluded
    await w.issue({ assigneeId: w.u.member.id, storyPoints: 8, deletedAt: new Date() }); // deleted
    await w.issue({ assigneeId: w.u.pm.id, storyPoints: 13 });
    await w.issue({ storyPoints: 2 }); // unassigned
    await w.issue({ assigneeId: w.u.outsider.id, storyPoints: 1 }); // no longer has access

    const res = await w.get(w.c.pm, `/projects/${w.pid}/reports/workload`);
    expect(res.status).toBe(200);
    const rows = res.body.rows.map(
      (r: {
        assignee: { name: string } | null;
        activeMember: boolean;
        openIssues: number;
        points: number;
        unestimated: number;
      }) => [r.assignee?.name ?? null, r.activeMember, r.openIssues, r.points, r.unestimated],
    );
    expect(rows).toEqual([
      ['pm', true, 1, 13, 0],
      ['member', true, 3, 5, 1],
      ['outsider', false, 1, 1, 0],
      [null, true, 1, 2, 0],
    ]);

    await db.project.update({
      where: { id: w.pid },
      data: { archivedAt: new Date(), archivedById: w.u.owner.id },
    });
    expect((await w.get(w.c.pm, `/projects/${w.pid}/reports/workload`)).body).toMatchObject({
      archived: true,
      rows: [],
    });
  });

  it('empty project: zero-safe overview, workload, velocity', async () => {
    const w = await world();
    expect(
      (await w.get(w.c.pm, `/projects/${w.pid}/reports/overview`)).body.overview,
    ).toMatchObject({
      totalIssues: 0,
      progressPercent: 0,
      byType: {},
    });
    expect((await w.get(w.c.pm, `/projects/${w.pid}/reports/workload`)).body.rows).toEqual([]);
    expect((await w.get(w.c.pm, `/projects/${w.pid}/reports/velocity`)).body).toMatchObject({
      averageCompletedPoints: 0,
      sprints: [],
    });
  });
});

describe('FR-RPT-003/004 sprint burndown and velocity', () => {
  it('TC-RPT-004-1 velocity = completed points of the last N COMPLETED sprints; cancelled excluded', async () => {
    const w = await world();
    const mk = async (
      name: string,
      status: 'COMPLETED' | 'CANCELLED',
      daysAgo: number,
      points: [number | null, number | null][],
    ) => {
      const closedAt = new Date(Date.now() - daysAgo * DAY);
      const s = await db.sprint.create({
        data: {
          projectId: w.pid,
          name,
          startAt: new Date(closedAt.getTime() - 7 * DAY),
          endAt: closedAt,
          status,
          startedAt: status === 'COMPLETED' ? new Date(closedAt.getTime() - 7 * DAY) : null,
          closedAt: status === 'COMPLETED' ? closedAt : null,
          cancelledAt: status === 'CANCELLED' ? closedAt : null,
        },
      });
      for (const [committed, completed] of points) {
        const i = await w.issue({});
        await db.sprintIssueHistory.create({
          data: {
            sprintId: s.id,
            issueId: i.id,
            projectId: w.pid,
            committedAt: committed === undefined ? null : s.startedAt,
            committedPoints: committed,
            completedAt: completed === null ? null : closedAt,
            completedPoints: completed,
            removedAt: completed === null ? closedAt : null,
          },
        });
      }
      return s;
    };
    await mk('S1', 'COMPLETED', 30, [
      [5, 5],
      [3, null],
    ]);
    await mk('S2', 'COMPLETED', 20, [
      [8, 8],
      [null, 0],
    ]);
    await mk('X', 'CANCELLED', 15, [[50, 50]]);
    await mk('S3', 'COMPLETED', 10, [
      [2, 2],
      [3, 3],
    ]);
    // Scope added mid-sprint (no committedAt) still counts in completedPoints.
    const s3 = await db.sprint.findFirstOrThrow({ where: { name: 'S3' } });
    const added = await w.issue({});
    await db.sprintIssueHistory.create({
      data: {
        sprintId: s3.id,
        issueId: added.id,
        projectId: w.pid,
        completedAt: s3.closedAt,
        completedPoints: 4,
      },
    });

    const v = (await w.get(w.c.member, `/projects/${w.pid}/reports/velocity`)).body;
    expect(
      v.sprints.map((s: { name: string; committedPoints: number; completedPoints: number }) => [
        s.name,
        s.committedPoints,
        s.completedPoints,
      ]),
    ).toEqual([
      ['S1', 8, 5],
      ['S2', 8, 8],
      ['S3', 5, 9],
    ]);
    expect(v.averageCompletedPoints).toBe(7.3);
    expect(v.sprints[1].unestimatedCompleted).toBe(0);
    expect(v.range.timezone).toBe('UTC');
    const two = (await w.get(w.c.member, `/projects/${w.pid}/reports/velocity?limit=2`)).body;
    expect(two.sprints.map((s: { name: string }) => s.name)).toEqual(['S2', 'S3']);
    expect((await w.get(w.c.member, `/projects/${w.pid}/reports/velocity?limit=0`)).status).toBe(
      422,
    );
  });

  it('TC-RPT-003-1 burndown via API: scope change, unestimated vs zero, stored metrics win', async () => {
    const w = await world();
    const a = await w.issue({ storyPoints: 5 });
    const b = await w.issue({ storyPoints: 0 }); // estimated at zero: not "unestimated"
    const c = await w.issue({ storyPoints: null });
    const sprint = await startedSprint(w, 2, [
      { id: a.id, storyPoints: 5 },
      { id: b.id, storyPoints: 0 },
      { id: c.id, storyPoints: null },
    ]);
    // A done yesterday; D (3 pts) added yesterday as scope change.
    const yesterday = new Date(Date.now() - DAY);
    await db.issue.update({ where: { id: a.id }, data: { status: 'DONE' } });
    await db.issueActivity.create({
      data: {
        issueId: a.id,
        actorId: w.u.pm.id,
        field: 'status',
        oldValue: 'TO_DO',
        newValue: 'DONE',
        createdAt: yesterday,
      },
    });
    const d = await w.issue({ storyPoints: 3 });
    await db.sprintIssueHistory.create({
      data: { sprintId: sprint.id, issueId: d.id, projectId: w.pid, addedAt: yesterday },
    });

    const res = await w.get(w.c.member, `/sprints/${sprint.id}/burndown`);
    expect(res.status).toBe(200);
    const today = localDate(new Date(), 'UTC');
    const day = (date: string) => res.body.days.find((x: { date: string }) => x.date === date);
    expect(res.body.range).toMatchObject({ timezone: 'UTC', from: addDays(today, -2) });
    expect(res.body.committedPoints).toBe(5);
    expect(day(addDays(today, -2))).toMatchObject({
      remainingCommittedPoints: 5,
      scopeAddedPoints: 0,
      idealPoints: 5,
    });
    expect(day(addDays(today, -1))).toMatchObject({
      remainingCommittedPoints: 0,
      scopeAddedPoints: 3,
    });
    expect(day(addDays(today, 1))).toMatchObject({ remainingCommittedPoints: null });
    expect(res.body.unestimated).toEqual([
      { id: c.id, key: c.key, title: c.title, committed: true },
    ]);

    // A stored daily metric is the source of truth for its day.
    await db.sprintDailyMetric.create({
      data: {
        sprintId: sprint.id,
        metricDate: new Date(`${addDays(today, -2)}T00:00:00Z`),
        remainingCommittedPoints: 42,
        scopeAddedPoints: 0,
      },
    });
    const again = (await w.get(w.c.member, `/sprints/${sprint.id}/burndown`)).body;
    expect(again.days[0].remainingCommittedPoints).toBe(42);

    expect((await w.get(w.c.outsider, `/sprints/${sprint.id}/burndown`)).status).toBe(404);
    expect((await w.get(w.c.rival, `/sprints/${sprint.id}/burndown`)).status).toBe(404);
    expect((await w.get(w.c.rival, `/sprints/not-a-uuid/burndown`)).status).toBe(404);
  });

  it('a planned sprint has an empty burndown', async () => {
    const w = await world();
    const s = await db.sprint.create({
      data: {
        projectId: w.pid,
        name: 'P',
        startAt: new Date(),
        endAt: new Date(Date.now() + 7 * DAY),
      },
    });
    const res = (await w.get(w.c.pm, `/sprints/${s.id}/burndown`)).body;
    expect(res).toMatchObject({ committedPoints: 0, days: [], unestimated: [] });
  });

  it('completion writes final metrics synchronously; later changes do not alter the history', async () => {
    const w = await world();
    const a = await w.issue({ storyPoints: 5 });
    const sprint = await startedSprint(w, 1, [{ id: a.id, storyPoints: 5 }]);
    await db.issue.update({ where: { id: a.id }, data: { status: 'DONE' } });
    await db.issueActivity.create({
      data: {
        issueId: a.id,
        actorId: w.u.pm.id,
        field: 'status',
        oldValue: 'TO_DO',
        newValue: 'DONE',
      },
    });
    const done = await request(w.app)
      .post(`${api}/sprints/${sprint.id}/complete`)
      .set(as(w.c.pm))
      .send({ destination: { type: 'backlog' } });
    expect(done.status).toBe(200);
    const metrics = await db.sprintDailyMetric.findMany({
      where: { sprintId: sprint.id },
      orderBy: { metricDate: 'asc' },
    });
    expect(metrics.map((m) => m.remainingCommittedPoints)).toEqual([5, 0]);
    const before = (await w.get(w.c.pm, `/sprints/${sprint.id}/burndown`)).body;

    // Reopen and re-estimate after completion.
    const current = await db.issue.findUniqueOrThrow({ where: { id: a.id } });
    await request(w.app)
      .patch(`${api}/issues/${a.id}`)
      .set(as(w.c.pm))
      .send({ version: current.version, status: 'TO_DO', storyPoints: 13 });
    expect((await w.get(w.c.pm, `/sprints/${sprint.id}/burndown`)).body).toEqual(before);
    // Completed sprints are no longer refreshed by the hourly job.
    expect(await runHourlyJobs(db, memoryLogger().logger)).toMatchObject({ sprintsMeasured: 0 });
  });
});

describe('ADR-018 scheduled sprint metrics', () => {
  it('hourly job stores one row per completed local day, idempotently and under concurrency', async () => {
    const w = await world('America/Los_Angeles');
    const a = await w.issue({ storyPoints: 3 });
    const sprint = await startedSprint(w, 3, [{ id: a.id, storyPoints: 3 }]);
    const { logger } = memoryLogger();
    const results = await Promise.all([
      runHourlyJobs(db, logger),
      runHourlyJobs(db, logger),
      runHourlyJobs(db, logger),
    ]);
    expect(results.filter((r) => r !== null).length).toBeGreaterThanOrEqual(1);
    // Direct concurrent writers (e.g. completion racing the job) never duplicate a day.
    await Promise.all([
      db.$transaction((tx) => writeSprintMetrics(tx, sprint.id)),
      db.$transaction((tx) => writeSprintMetrics(tx, sprint.id)),
    ]);
    await runHourlyJobs(db, logger);
    const rows = await db.sprintDailyMetric.findMany({
      where: { sprintId: sprint.id },
      orderBy: { metricDate: 'asc' },
    });
    const tz = 'America/Los_Angeles';
    const today = localDate(new Date(), tz);
    const from = localDate(sprint.startedAt!, tz);
    // Every local day from the start up to (not including) today; today is still open.
    const expected: string[] = [];
    for (let d = from; d < today; d = addDays(d, 1)) expected.push(d);
    expect(rows.map((r) => r.metricDate.toISOString().slice(0, 10))).toEqual(expected);
    expect(rows.every((r) => r.remainingCommittedPoints === 3)).toBe(true);

    // A timezone change recomputes ACTIVE sprints' days in the new zone.
    await db.workspace.update({ where: { id: w.wid }, data: { timezone: 'Pacific/Kiritimati' } });
    await runHourlyJobs(db, logger);
    const k = 'Pacific/Kiritimati';
    const kRows = await db.sprintDailyMetric.findMany({
      where: { sprintId: sprint.id },
      orderBy: { metricDate: 'asc' },
    });
    expect(kRows[0]!.metricDate.toISOString().slice(0, 10)).toBe(localDate(sprint.startedAt!, k));
    expect(kRows.at(-1)!.metricDate.toISOString().slice(0, 10)).toBe(
      addDays(localDate(new Date(), k), -1),
    );
  });
});
