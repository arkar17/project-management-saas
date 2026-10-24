import {
  ErrorCode,
  type CompleteSprintInput,
  type CreateSprintInput,
  type SprintDetailDto,
  type SprintDto,
  type SprintIssuesInput,
  type SprintReportDto,
  type UpdateSprintInput,
} from '@pm/shared';
import { Prisma, type Sprint, type SprintStatus } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import {
  assertCan,
  assertId,
  assertWritable,
  resolveProjectAccess,
  type ProjectAccess,
} from '../../policy/access.js';
import { issueInclude, lockProject, toIssueDto } from '../issues/issue.service.js';

type Tx = Prisma.TransactionClient;
const OPEN: SprintStatus[] = ['PLANNED', 'ACTIVE'];

export function toSprintDto(s: Sprint & { issues: { storyPoints: number | null }[] }): SprintDto {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.name,
    goal: s.goal,
    status: s.status,
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
    startedAt: s.startedAt?.toISOString() ?? null,
    closedAt: s.closedAt?.toISOString() ?? null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    issueCount: s.issues.length,
    points: s.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
  };
}

const withIssues = {
  issues: { where: { deletedAt: null }, select: { storyPoints: true } },
} as const;

const badState = (message: string) => conflict(ErrorCode.INVALID_SPRINT_STATE, message);
const invalid = (code: string, message: string) => new AppError(422, code, message);
const inOtherSprint = () =>
  conflict(
    ErrorCode.ISSUE_IN_OTHER_SPRINT,
    'An issue is already in another open sprint; remove it there first',
  );

/**
 * Adds issues to an open sprint: same project, not deleted, not in another PLANNED/ACTIVE
 * sprint (FR-SPR-001). Status is never touched (FR-BRD-001). History rows added to an ACTIVE
 * sprint have no committedAt, which marks them as scope added after start (ADR-003).
 */
async function addIssues(
  tx: Tx,
  sprint: Sprint,
  issueIds: string[],
  actorId: string,
  at = new Date(),
) {
  if (issueIds.length === 0) return;
  const unique = [...new Set(issueIds)];
  const issues = await tx.issue.findMany({
    where: { id: { in: unique }, projectId: sprint.projectId, deletedAt: null },
    include: { sprint: { select: { status: true } } },
  });
  if (issues.length !== unique.length) {
    throw invalid(ErrorCode.VALIDATION_ERROR, 'Issues must be live issues of this project');
  }
  const toAdd = issues.filter((i) => i.sprintId !== sprint.id);
  if (toAdd.some((i) => i.sprint && OPEN.includes(i.sprint.status))) throw inOtherSprint();
  if (toAdd.length === 0) return;

  await tx.issue.updateMany({
    where: { id: { in: toAdd.map((i) => i.id) } },
    data: { sprintId: sprint.id, version: { increment: 1 } },
  });
  // The partial unique index (one open row per sprint+issue) backs this up at the DB level.
  await tx.sprintIssueHistory.createMany({
    data: toAdd.map((i) => ({
      sprintId: sprint.id,
      issueId: i.id,
      projectId: sprint.projectId,
      addedAt: at,
    })),
  });
  await tx.issueActivity.createMany({
    data: toAdd.map((i) => ({
      issueId: i.id,
      actorId,
      field: 'sprintId',
      oldValue: i.sprintId,
      newValue: sprint.id,
    })),
  });
}

async function removeIssues(
  tx: Tx,
  sprint: Sprint,
  issueIds: string[],
  actorId: string,
  at = new Date(),
) {
  if (issueIds.length === 0) return;
  const issues = await tx.issue.findMany({
    where: { id: { in: [...new Set(issueIds)] }, sprintId: sprint.id },
    select: { id: true },
  });
  if (issues.length !== new Set(issueIds).size) {
    throw invalid(ErrorCode.VALIDATION_ERROR, 'Only issues in this sprint can be removed');
  }
  const ids = issues.map((i) => i.id);
  await tx.issue.updateMany({
    where: { id: { in: ids } },
    data: { sprintId: null, version: { increment: 1 } },
  });
  await tx.sprintIssueHistory.updateMany({
    where: { sprintId: sprint.id, issueId: { in: ids }, removedAt: null },
    data: { removedAt: at },
  });
  await tx.issueActivity.createMany({
    data: ids.map((id) => ({
      issueId: id,
      actorId,
      field: 'sprintId',
      oldValue: sprint.id,
      newValue: null,
    })),
  });
}

export function createSprintService(db: Db) {
  /** Sprint → Project → Workspace ancestry; invisible sprints are 404. */
  async function resolve(userId: string, sprintId: string) {
    const sprint = await db.sprint.findUnique({ where: { id: assertId(sprintId) } });
    if (!sprint) throw notFound();
    const access = await resolveProjectAccess(db, userId, sprint.projectId);
    return { sprint, access };
  }

  /** Mutations: PM+ on a writable project, re-reading the sprint under the project lock. */
  async function mutate<T>(
    userId: string,
    sprintId: string,
    fn: (tx: Tx, sprint: Sprint, access: ProjectAccess) => Promise<T>,
  ) {
    const { access } = await resolve(userId, sprintId);
    assertCan(access, 'manageSprintsAndBacklog');
    assertWritable(access);
    return db.$transaction(async (tx) => {
      await lockProject(tx, access.projectId);
      const sprint = await tx.sprint.findUniqueOrThrow({ where: { id: sprintId } });
      return fn(tx, sprint, access);
    });
  }

  async function detail(tx: Tx | Db, sprintId: string): Promise<SprintDetailDto> {
    const sprint = await tx.sprint.findUniqueOrThrow({
      where: { id: sprintId },
      include: withIssues,
    });
    const issues = await tx.issue.findMany({
      where: { sprintId, deletedAt: null },
      include: issueInclude,
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    });
    return { sprint: toSprintDto(sprint), issues: issues.map(toIssueDto) };
  }

  return {
    resolve,
    detail,

    async list(access: ProjectAccess, status?: SprintStatus[]): Promise<SprintDto[]> {
      const rows = await db.sprint.findMany({
        where: { projectId: access.projectId, ...(status ? { status: { in: status } } : {}) },
        include: withIssues,
        orderBy: [{ startAt: 'desc' }, { createdAt: 'desc' }],
      });
      return rows.map(toSprintDto);
    },

    async create(access: ProjectAccess, input: CreateSprintInput): Promise<SprintDetailDto> {
      assertCan(access, 'manageSprintsAndBacklog');
      assertWritable(access);
      return db.$transaction(async (tx) => {
        await lockProject(tx, access.projectId);
        const sprint = await tx.sprint.create({
          data: {
            projectId: access.projectId,
            name: input.name,
            goal: input.goal ?? null,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
          },
        });
        await addIssues(tx, sprint, input.issueIds ?? [], access.userId);
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'sprint.created',
          targetType: 'Sprint',
          targetId: sprint.id,
        });
        return detail(tx, sprint.id);
      });
    },

    /** FR-SPR-006: PLANNED — name/goal/dates; ACTIVE — name/goal/endAt; closed — immutable. */
    update(userId: string, sprintId: string, input: UpdateSprintInput) {
      return mutate(userId, sprintId, async (tx, sprint) => {
        if (sprint.status === 'COMPLETED' || sprint.status === 'CANCELLED') {
          throw badState('Completed and cancelled sprints cannot be edited');
        }
        if (sprint.status === 'ACTIVE' && input.startAt !== undefined) {
          throw badState('The start of an active sprint cannot be changed');
        }
        const startAt = input.startAt ? new Date(input.startAt) : sprint.startAt;
        const endAt = input.endAt ? new Date(input.endAt) : sprint.endAt;
        if (startAt >= endAt)
          throw invalid(ErrorCode.VALIDATION_ERROR, 'The end must be after the start');
        await tx.sprint.update({
          where: { id: sprint.id },
          data: { name: input.name, goal: input.goal, startAt, endAt },
        });
        return detail(tx, sprint.id);
      });
    },

    /** PUT /sprints/:sid/issues — planning (PLANNED) or scope change (ACTIVE). */
    changeIssues(userId: string, sprintId: string, input: SprintIssuesInput) {
      return mutate(userId, sprintId, async (tx, sprint, access) => {
        if (!OPEN.includes(sprint.status))
          throw badState('Only planned or active sprints accept changes');
        await removeIssues(tx, sprint, input.remove, access.userId);
        await addIssues(tx, sprint, input.add, access.userId);
        return detail(tx, sprint.id);
      });
    },

    /**
     * FR-SPR-002/003: one ACTIVE sprint per project (checked under the project lock and backed
     * by the partial unique index). Every open row gets its committed points frozen now.
     */
    start(userId: string, sprintId: string) {
      return mutate(userId, sprintId, async (tx, sprint, access) => {
        if (sprint.status !== 'PLANNED') throw badState('Only planned sprints can be started');
        const active = await tx.sprint.findFirst({
          where: { projectId: sprint.projectId, status: 'ACTIVE' },
        });
        if (active)
          throw conflict(ErrorCode.ACTIVE_SPRINT_EXISTS, `“${active.name}” is already active`);
        const now = new Date();
        try {
          await tx.sprint.update({
            where: { id: sprint.id },
            data: { status: 'ACTIVE', startedAt: now },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw conflict(ErrorCode.ACTIVE_SPRINT_EXISTS, 'Another sprint is already active');
          }
          throw err;
        }
        const rows = await tx.sprintIssueHistory.findMany({
          where: { sprintId: sprint.id, removedAt: null },
          include: { issue: { select: { storyPoints: true } } },
        });
        for (const row of rows) {
          // ADR-003: unestimated issues keep a null snapshot (the "unestimated" flag reports
          // need) and count as 0 in every sum; later estimate changes do not apply.
          await tx.sprintIssueHistory.update({
            where: { id: row.id },
            data: { committedAt: now, committedPoints: row.issue.storyPoints },
          });
        }
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'sprint.started',
          targetType: 'Sprint',
          targetId: sprint.id,
          metadata: { committedIssues: rows.length },
        });
        return detail(tx, sprint.id);
      });
    },

    /**
     * FR-SPR-003/004: DONE issues get completedAt/completedPoints and stay with the sprint;
     * unfinished issues leave (removedAt) for the explicitly chosen destination.
     */
    complete(userId: string, sprintId: string, input: CompleteSprintInput) {
      return mutate(userId, sprintId, async (tx, sprint, access) => {
        if (sprint.status !== 'ACTIVE') throw badState('Only the active sprint can be completed');
        let target: Sprint | null = null;
        if (input.destination.type === 'sprint') {
          target = await tx.sprint.findFirst({
            where: {
              id: input.destination.sprintId,
              projectId: sprint.projectId,
              status: 'PLANNED',
            },
          });
          if (!target)
            throw invalid(
              ErrorCode.DESTINATION_REQUIRED,
              'Choose the backlog or a planned sprint of this project',
            );
        }
        const now = new Date();
        const rows = await tx.sprintIssueHistory.findMany({
          where: { sprintId: sprint.id, removedAt: null },
          include: {
            issue: { select: { id: true, status: true, storyPoints: true, deletedAt: true } },
          },
        });
        const done = rows.filter((r) => r.issue.status === 'DONE' && !r.issue.deletedAt);
        const unfinished = rows.filter((r) => r.issue.status !== 'DONE' && !r.issue.deletedAt);
        for (const row of done) {
          await tx.sprintIssueHistory.update({
            where: { id: row.id },
            data: { completedAt: now, completedPoints: row.issue.storyPoints },
          });
        }
        await removeIssues(
          tx,
          sprint,
          unfinished.map((r) => r.issue.id),
          access.userId,
          now,
        );
        if (target)
          await addIssues(
            tx,
            target,
            unfinished.map((r) => r.issue.id),
            access.userId,
            now,
          );
        await tx.sprint.update({
          where: { id: sprint.id },
          data: { status: 'COMPLETED', closedAt: now },
        });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'sprint.completed',
          targetType: 'Sprint',
          targetId: sprint.id,
          metadata: {
            completed: done.length,
            carriedOver: unfinished.length,
            destination: target?.id ?? 'backlog',
          },
        });
        return detail(tx, sprint.id);
      });
    },

    /** ADR-017: only PLANNED sprints can be cancelled; their issues return to the backlog. */
    cancel(userId: string, sprintId: string) {
      return mutate(userId, sprintId, async (tx, sprint, access) => {
        if (sprint.status !== 'PLANNED') throw badState('Only planned sprints can be cancelled');
        const ids = (
          await tx.issue.findMany({ where: { sprintId: sprint.id }, select: { id: true } })
        ).map((i) => i.id);
        await removeIssues(tx, sprint, ids, access.userId);
        await tx.sprint.update({
          where: { id: sprint.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'sprint.cancelled',
          targetType: 'Sprint',
          targetId: sprint.id,
        });
        return detail(tx, sprint.id);
      });
    },

    /** FR-SPR-005: computed only from frozen history values, so it never drifts after close. */
    async report(sprintId: string): Promise<SprintReportDto> {
      const sprint = await db.sprint.findUniqueOrThrow({
        where: { id: sprintId },
        include: withIssues,
      });
      const rows = await db.sprintIssueHistory.findMany({ where: { sprintId } });
      const committed = rows.filter((r) => r.committedAt);
      const startedAt = sprint.startedAt?.getTime();
      const closedAt = sprint.closedAt?.getTime();
      const completed = rows.filter((r) => r.completedAt);
      return {
        sprint: toSprintDto(sprint),
        committedIssues: committed.length,
        committedPoints: committed.reduce((s, r) => s + (r.committedPoints ?? 0), 0),
        unestimatedCommitted: committed.filter((r) => r.committedPoints === null).length,
        addedAfterStart: startedAt
          ? rows.filter((r) => !r.committedAt && r.addedAt.getTime() >= startedAt).length
          : 0,
        removedDuringSprint: rows.filter(
          (r) =>
            r.removedAt &&
            (!closedAt || r.removedAt.getTime() < closedAt) &&
            startedAt &&
            r.removedAt.getTime() >= startedAt,
        ).length,
        completedIssues: completed.length,
        completedPoints: completed.reduce((s, r) => s + (r.completedPoints ?? 0), 0),
        carriedOver: closedAt ? rows.filter((r) => r.removedAt?.getTime() === closedAt).length : 0,
      };
    },
  };
}

export type SprintService = ReturnType<typeof createSprintService>;
