/**
 * Deterministic fictional demo data (FR-UX-004): two workspaces, three projects, six people,
 * issues across every status/type/priority, a completed, an active and a planned sprint with
 * history and daily metrics, comments, watchers and notifications. Every name is invented.
 *
 * Safety: refuses to run unless DEMO_SEED_CONFIRM=yes, DEMO_PASSWORD (≥ 10 chars) is set and the
 * target database has no workspaces yet, so it can never touch an existing real/shared database.
 *   DEMO_SEED_CONFIRM=yes DEMO_PASSWORD=… DATABASE_URL=… npm run db:seed:demo
 * Dates are relative to the run time so reports always show a current sprint.
 */
import type { Prisma } from '@prisma/client';
import { PrismaClient, type IssuePriority, type IssueStatus, type IssueType } from '@prisma/client';
import { hashPassword } from '../apps/api/src/lib/password.js';

const password = process.env.DEMO_PASSWORD ?? '';
if (process.env.DEMO_SEED_CONFIRM !== 'yes' || password.length < 10) {
  console.error('Set DEMO_SEED_CONFIRM=yes and DEMO_PASSWORD (min 10 chars) to seed demo data.');
  process.exit(1);
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const day = (offset: number) => new Date(now + offset * DAY);

const PEOPLE = [
  { key: 'maya', name: 'Maya Okafor', email: 'maya@demo.example' },
  { key: 'leo', name: 'Leo Brandt', email: 'leo@demo.example' },
  { key: 'iris', name: 'Iris Tanaka', email: 'iris@demo.example' },
  { key: 'omar', name: 'Omar Haddad', email: 'omar@demo.example' },
  { key: 'zoe', name: 'Zoe Lindqvist', email: 'zoe@demo.example' },
  { key: 'raj', name: 'Raj Menon', email: 'raj@demo.example' },
] as const;
type Person = (typeof PEOPLE)[number]['key'];

/** [title, type, status, priority, points, assignee, sprint, dueInDays] */
type IssueSpec = [
  string,
  IssueType,
  IssueStatus,
  IssuePriority,
  number | null,
  Person | null,
  'done' | 'active' | 'planned' | null,
  number | null,
];
const ROVER_ISSUES: IssueSpec[] = [
  ['Navigation stack', 'EPIC', 'IN_PROGRESS', 'HIGH', null, 'maya', null, 30],
  ['Calibrate wheel encoders', 'STORY', 'DONE', 'HIGH', 5, 'leo', 'done', -10],
  ['Obstacle map from lidar', 'STORY', 'DONE', 'MEDIUM', 8, 'iris', 'done', -9],
  ['Telemetry dashboard prototype', 'TASK', 'DONE', 'LOW', 3, 'omar', 'done', -8],
  ['Battery drain on idle', 'BUG', 'IN_REVIEW', 'HIGHEST', 3, 'leo', 'active', 1],
  ['Path planner: A* baseline', 'STORY', 'IN_PROGRESS', 'HIGH', 8, 'iris', 'active', 4],
  ['Motor driver watchdog', 'TASK', 'DONE', 'MEDIUM', 2, 'leo', 'active', -1],
  ['Spike: SLAM library options', 'TASK', 'TO_DO', 'MEDIUM', null, 'maya', 'active', 6],
  ['Remote e-stop over radio', 'STORY', 'TO_DO', 'HIGHEST', 5, 'omar', 'active', 5],
  ['Firmware OTA updates', 'STORY', 'TO_DO', 'MEDIUM', 13, null, 'planned', 20],
  ['Log rotation on SD card', 'TASK', 'BACKLOG', 'LOW', 1, null, null, null],
  ['Compass drift near motors', 'BUG', 'BACKLOG', 'HIGH', 2, 'iris', null, -3],
  ['Document wiring harness', 'TASK', 'BACKLOG', 'LOWEST', 0, 'omar', null, 12],
];
const WEB_ISSUES: IssueSpec[] = [
  ['Customer portal login', 'STORY', 'DONE', 'HIGH', 5, 'zoe', null, -4],
  ['Order history table', 'STORY', 'IN_PROGRESS', 'MEDIUM', 5, 'raj', null, 3],
  ['Dark mode for portal', 'TASK', 'TO_DO', 'LOW', 3, 'zoe', null, 9],
  ['Broken link in footer', 'BUG', 'BACKLOG', 'LOW', 1, null, null, null],
];

const db = new PrismaClient();

async function main() {
  if ((await db.workspace.count()) > 0) {
    throw new Error(
      'Refusing to seed: the database already has workspaces (use an empty database).',
    );
  }
  const passwordHash = await hashPassword(password);
  const users = {} as Record<Person, { id: string }>;
  for (const p of PEOPLE) {
    users[p.key] = await db.user.create({
      data: {
        email: p.email,
        name: p.name,
        passwordHash,
        verifiedAt: day(-60),
        timezone: 'Europe/Berlin',
      },
    });
  }

  await db.$transaction(
    async (tx) => {
      const acme = await tx.workspace.create({
        data: { slug: 'acme-robotics', name: 'Acme Robotics', timezone: 'Europe/Berlin' },
      });
      const studio = await tx.workspace.create({
        data: { slug: 'northwind-studio', name: 'Northwind Studio', timezone: 'America/New_York' },
      });
      const wsRoles: [string, Person, 'OWNER' | 'ADMIN' | 'MEMBER'][] = [
        [acme.id, 'maya', 'OWNER'],
        [acme.id, 'leo', 'ADMIN'],
        [acme.id, 'iris', 'MEMBER'],
        [acme.id, 'omar', 'MEMBER'],
        [studio.id, 'zoe', 'OWNER'],
        [studio.id, 'raj', 'MEMBER'],
        [studio.id, 'maya', 'MEMBER'],
      ];
      for (const [workspaceId, who, role] of wsRoles) {
        await tx.workspaceMember.create({
          data: { workspaceId, userId: users[who].id, role, joinedAt: day(-55) },
        });
      }

      const rover = await project(
        tx,
        acme.id,
        'ROV',
        'Rover Firmware',
        'maya',
        ['iris', 'omar'],
        'leo',
      );
      await project(tx, acme.id, 'OPS', 'Field Operations', 'maya', ['omar'], null, true);
      const web = await project(
        tx,
        studio.id,
        'WEB',
        'Customer Portal',
        'zoe',
        ['raj', 'maya'],
        null,
      );

      const sprints = {
        done: await tx.sprint.create({
          data: {
            projectId: rover.id,
            name: 'Sprint 1 — Foundations',
            goal: 'Drive in a straight line',
            startAt: day(-17),
            endAt: day(-3),
            status: 'COMPLETED',
            startedAt: day(-17),
            closedAt: day(-3),
          },
        }),
        active: await tx.sprint.create({
          data: {
            projectId: rover.id,
            name: 'Sprint 2 — Autonomy',
            goal: 'Avoid the first obstacle',
            startAt: day(-3),
            endAt: day(11),
            status: 'ACTIVE',
            startedAt: day(-3),
          },
        }),
        planned: await tx.sprint.create({
          data: {
            projectId: rover.id,
            name: 'Sprint 3 — Connectivity',
            startAt: day(11),
            endAt: day(25),
          },
        }),
      };
      await tx.sprint.create({
        data: {
          projectId: rover.id,
          name: 'Hack week (cancelled)',
          startAt: day(-25),
          endAt: day(-20),
          status: 'CANCELLED',
          cancelledAt: day(-24),
        },
      });
      const label = await tx.label.create({
        data: { projectId: rover.id, name: 'hardware', color: '#b45309' },
      });

      const roverIssues = await issues(tx, acme.id, rover.id, 'ROV', 'maya', ROVER_ISSUES, sprints);
      await issues(tx, studio.id, web.id, 'WEB', 'zoe', WEB_ISSUES, {});
      await tx.issueLabel.createMany({
        data: roverIssues
          .filter((i) => /Motor|Battery|Compass/.test(i.title))
          .map((i) => ({ issueId: i.id, labelId: label.id, projectId: rover.id })),
      });
      const epic = roverIssues[0]!;
      await tx.issue.updateMany({
        where: { id: { in: roverIssues.slice(4, 7).map((i) => i.id) } },
        data: { parentId: epic.id },
      });

      const battery = roverIssues.find((i) => i.title.startsWith('Battery'))!;
      await tx.issueComment.create({
        data: {
          issueId: battery.id,
          authorId: users.iris.id,
          body: 'Reproduced on unit #3 — @leo@demo.example can you check the sleep timer?',
          createdAt: day(-1),
        },
      });
      await tx.issueWatcher.createMany({
        data: [battery.id].flatMap((issueId) =>
          ['maya', 'leo', 'iris'].map((p) => ({ issueId, userId: users[p as Person].id })),
        ),
        skipDuplicates: true,
      });
      await tx.notification.createMany({
        data: [
          {
            recipientId: users.leo.id,
            workspaceId: acme.id,
            projectId: rover.id,
            issueId: battery.id,
            type: 'MENTIONED',
            payload: { actorId: users.iris.id },
            dedupeKey: 'demo:mention:1',
          },
          {
            recipientId: users.omar.id,
            workspaceId: acme.id,
            projectId: rover.id,
            issueId: roverIssues[8]!.id,
            type: 'ASSIGNED',
            payload: { actorId: users.maya.id },
            dedupeKey: 'demo:assign:1',
          },
        ],
      });
    },
    { timeout: 60_000 },
  );

  async function project(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    key: string,
    name: string,
    creator: Person,
    members: Person[],
    pm: Person | null,
    archived = false,
  ) {
    const p = await tx.project.create({
      data: {
        workspaceId,
        key,
        name,
        description: `${name} — fictional demo project.`,
        createdById: users[creator].id,
        startDate: day(-30),
        targetDate: day(60),
        ...(archived ? { archivedAt: day(-2), archivedById: users[creator].id } : {}),
      },
    });
    for (const who of [...members, ...(pm ? [pm] : [])]) {
      await tx.projectMember.create({
        data: {
          projectId: p.id,
          userId: users[who].id,
          role: who === pm ? 'PROJECT_MANAGER' : 'MEMBER',
        },
      });
    }
    return p;
  }

  async function issues(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    key: string,
    reporter: Person,
    specs: IssueSpec[],
    sprints: Partial<
      Record<
        'done' | 'active' | 'planned',
        { id: string; startedAt: Date | null; closedAt: Date | null }
      >
    >,
  ) {
    const created: { id: string; title: string }[] = [];
    for (const [
      n,
      [title, type, status, priority, storyPoints, assignee, sprintKey, due],
    ] of specs.entries()) {
      const sprint = sprintKey ? sprints[sprintKey] : undefined;
      const issue = await tx.issue.create({
        data: {
          workspaceId,
          projectId,
          number: n + 1,
          key: `${key}-${n + 1}`,
          type,
          title,
          status,
          priority,
          storyPoints,
          reporterId: users[reporter].id,
          assigneeId: assignee ? users[assignee].id : null,
          dueAt: due === null ? null : day(due),
          rank: `a${String(n).padStart(3, '0')}`,
          sprintId: sprintKey === 'active' || sprintKey === 'planned' ? sprint!.id : null,
          createdAt: day(-20 + n * 0.5),
        },
      });
      created.push({ id: issue.id, title });
      await tx.issueActivity.create({
        data: {
          issueId: issue.id,
          actorId: users[reporter].id,
          field: 'created',
          newValue: issue.key,
          createdAt: day(-20),
        },
      });
      if (assignee)
        await tx.issueWatcher.create({ data: { issueId: issue.id, userId: users[assignee].id } });
      if (sprint) {
        await tx.sprintIssueHistory.create({
          data: {
            sprintId: sprint.id,
            issueId: issue.id,
            projectId,
            addedAt: day(-18),
            committedAt: sprint.startedAt,
            committedPoints: sprint.startedAt ? storyPoints : null,
            ...(sprintKey === 'done'
              ? { completedAt: sprint.closedAt, completedPoints: storyPoints }
              : {}),
          },
        });
      }
      // Status history so burndowns reconcile with the issue activity (ADR-003).
      if (status === 'DONE' && sprint?.startedAt) {
        await tx.issueActivity.create({
          data: {
            issueId: issue.id,
            actorId: users[assignee ?? reporter].id,
            field: 'status',
            oldValue: 'IN_PROGRESS',
            newValue: 'DONE',
            createdAt: sprintKey === 'done' ? day(-8 + n) : day(-1),
          },
        });
      }
    }
    await tx.project.update({ where: { id: projectId }, data: { issueCounter: specs.length } });
    return created;
  }
}

try {
  await main();
  console.log(
    `Demo data created. Sign in as ${PEOPLE.map((p) => p.email).join(', ')} with DEMO_PASSWORD.`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
