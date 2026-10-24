import {
  ErrorCode,
  childrenError,
  hierarchyError,
  MAX_RANK_LENGTH,
  evenRanks,
  rankAfter,
  type ActivityDto,
  type CreateIssueInput,
  type IssueDto,
  type IssueField,
  type IssueListDto,
  type IssueListQuery,
  type UpdateIssueInput,
} from '@pm/shared';
import type { Prisma } from '@prisma/client';
import { AppError, conflict } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import {
  assertCan,
  assertIssueFieldsAllowed,
  assertWritable,
  type IssueAccess,
  type ProjectAccess,
} from '../../policy/access.js';

type Tx = Prisma.TransactionClient;

export const issueInclude = {
  reporter: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  parent: { select: { id: true, key: true, title: true, type: true } },
  labels: { include: { label: { select: { id: true, name: true, color: true } } } },
  _count: { select: { children: { where: { deletedAt: null } } } },
} satisfies Prisma.IssueInclude;

type IssueRow = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;

export function toIssueDto(i: IssueRow): IssueDto {
  return {
    id: i.id,
    projectId: i.projectId,
    key: i.key,
    number: i.number,
    type: i.type,
    title: i.title,
    description: i.description,
    status: i.status,
    priority: i.priority,
    reporter: i.reporter,
    assignee: i.assignee,
    parent: i.parent,
    sprintId: i.sprintId,
    storyPoints: i.storyPoints,
    rank: i.rank,
    version: i.version,
    dueAt: i.dueAt?.toISOString() ?? null,
    deletedAt: i.deletedAt?.toISOString() ?? null,
    labels: i.labels.map((l) => l.label),
    childCount: i._count.children,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

const invalidHierarchy = (message: string) =>
  new AppError(422, ErrorCode.INVALID_HIERARCHY, message);
const fieldForbidden = (fields: string[]) =>
  new AppError(403, ErrorCode.FIELD_FORBIDDEN, 'Field change not permitted', { fields });

/** Rows serialise on the project row lock, so concurrent appends never share a rank. */
export async function lockProject(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
}

/**
 * Rank after every issue of the project, i.e. the end of any status column and of the
 * backlog: one rank orders both views (ADR-016), so appends must not collide across statuses.
 * Callers hold the project row lock.
 */
export async function endOfColumn(tx: Tx, projectId: string, exceptId?: string): Promise<string> {
  const last = await tx.issue.findFirst({
    where: { projectId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { rank: 'desc' },
    select: { rank: true },
  });
  const key = rankAfter(last?.rank ?? null);
  if (key.length <= MAX_RANK_LENGTH) return key;
  await rebalanceRanks(tx, projectId);
  return endOfColumn(tx, projectId, exceptId);
}

/** Re-spaces every rank in the project, preserving order (FR-BRD-003). Caller holds the lock. */
export async function rebalanceRanks(tx: Tx, projectId: string) {
  const rows = await tx.issue.findMany({
    where: { projectId },
    orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const keys = evenRanks(rows.length);
  for (const [i, row] of rows.entries()) {
    await tx.issue.update({ where: { id: row.id }, data: { rank: keys[i]! } });
  }
}

/** FR-ISS-009: ACTIVE project member, or ACTIVE workspace Owner/Admin; else 422. */
async function assertAssigneeEligible(tx: Tx, access: ProjectAccess, userId: string) {
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: access.workspaceId, userId } },
    include: { user: { select: { status: true } } },
  });
  let eligible = member?.status === 'ACTIVE' && member.user.status === 'ACTIVE';
  if (eligible && member?.role === 'MEMBER') {
    const pm = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: access.projectId, userId } },
    });
    eligible = pm?.status === 'ACTIVE';
  }
  if (!eligible) {
    throw new AppError(
      422,
      ErrorCode.ASSIGNEE_NOT_ELIGIBLE,
      'The assignee must have access to this project',
    );
  }
}

/** Parent must be a live issue of the same project (also enforced by the composite FK). */
async function loadParent(tx: Tx, projectId: string, parentId: string) {
  const parent = await tx.issue.findUnique({
    where: { id: parentId },
    select: { id: true, type: true, projectId: true, deletedAt: true, parentId: true },
  });
  if (!parent || parent.projectId !== projectId || parent.deletedAt) {
    throw invalidHierarchy('The parent must be an issue in the same project');
  }
  return parent;
}

async function assertLabelsInProject(tx: Tx, projectId: string, labelIds: readonly string[]) {
  if (labelIds.length === 0) return;
  const count = await tx.label.count({ where: { projectId, id: { in: [...labelIds] } } });
  if (count !== new Set(labelIds).size) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, 'Labels must belong to this project');
  }
}

async function watch(tx: Tx, issueId: string, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  if (ids.length > 0) {
    await tx.issueWatcher.createMany({
      data: ids.map((userId) => ({ issueId, userId })),
      skipDuplicates: true,
    });
  }
}

/** Reference-only outbox event for G4 notification delivery, written in the same TX (ADR-005). */
function outbox(tx: Tx, topic: string, aggregateId: string, payload: Prisma.InputJsonObject) {
  return tx.outboxEvent.create({ data: { topic, aggregateId, payload } });
}

const stringify = (v: unknown) =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

const TRACKED: readonly (keyof Omit<UpdateIssueInput, 'version'> & keyof IssueRow)[] = [
  'type',
  'title',
  'status',
  'priority',
  'assigneeId',
  'parentId',
  'storyPoints',
  'dueAt',
];

export function createIssueService(db: Db) {
  async function load(tx: Tx | Db, id: string) {
    return tx.issue.findUniqueOrThrow({ where: { id }, include: issueInclude });
  }

  return {
    async list(access: ProjectAccess, q: IssueListQuery): Promise<IssueListDto> {
      const deleted = q.deleted === 'true';
      // The "Deleted" filter is for those who can restore (ADR-014).
      if (deleted) assertCan(access, 'softDeleteRestoreIssue');
      const where: Prisma.IssueWhereInput = {
        projectId: access.projectId,
        deletedAt: deleted ? { not: null } : null,
        ...(q.type ? { type: { in: q.type } } : {}),
        ...(q.status ? { status: { in: q.status } } : {}),
        ...(q.priority ? { priority: { in: q.priority } } : {}),
        ...(q.labelId ? { labels: { some: { labelId: q.labelId } } } : {}),
        ...(q.sprintId ? { sprintId: q.sprintId === 'none' ? null : q.sprintId } : {}),
        ...(q.assignee
          ? {
              assigneeId:
                q.assignee === 'none' ? null : q.assignee === 'me' ? access.userId : q.assignee,
            }
          : {}),
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' } },
                { key: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.issue.findMany({
          where,
          include: issueInclude,
          orderBy: { number: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.issue.count({ where }),
      ]);
      return { issues: rows.map(toIssueDto), total, page: q.page, pageSize: q.pageSize };
    },

    async get(access: IssueAccess): Promise<IssueDto> {
      return toIssueDto(await load(db, access.issueId));
    },

    async children(access: IssueAccess): Promise<IssueDto[]> {
      const rows = await db.issue.findMany({
        where: { parentId: access.issueId, deletedAt: null },
        include: issueInclude,
        orderBy: { number: 'asc' },
      });
      return rows.map(toIssueDto);
    },

    /**
     * FR-ISS-001: the project counter is incremented under its row lock, so keys are unique
     * and gap-free per project even under concurrent creation.
     */
    async create(access: ProjectAccess, input: CreateIssueInput): Promise<IssueDto> {
      assertCan(access, 'createIssue');
      assertWritable(access);
      if (access.actor === 'PROJECT_MEMBER') {
        // ADR-008: Members set type/title/description/dueAt/parent/labels; assignee self or none.
        const denied = (['status', 'priority', 'storyPoints'] as const).filter(
          (f) => input[f] !== undefined,
        );
        if (input.assigneeId && input.assigneeId !== access.userId)
          denied.push('assigneeId' as never);
        if (denied.length > 0) throw fieldForbidden(denied);
      }

      return db.$transaction(async (tx) => {
        const [counter] = await tx.$queryRaw<{ issueCounter: number; key: string }[]>`
          UPDATE "Project" SET "issueCounter" = "issueCounter" + 1
          WHERE id = ${access.projectId}::uuid RETURNING "issueCounter", key`;
        const number = counter!.issueCounter;

        const parent = input.parentId
          ? await loadParent(tx, access.projectId, input.parentId)
          : null;
        const hierarchy = hierarchyError(input.type, parent?.type ?? null);
        if (hierarchy) throw invalidHierarchy(hierarchy);
        if (input.assigneeId) await assertAssigneeEligible(tx, access, input.assigneeId);
        await assertLabelsInProject(tx, access.projectId, input.labelIds ?? []);

        const status = input.status ?? 'BACKLOG';
        const issue = await tx.issue.create({
          data: {
            workspaceId: access.workspaceId,
            projectId: access.projectId,
            number,
            key: `${counter!.key}-${number}`,
            type: input.type,
            title: input.title,
            description: input.description ?? null,
            status,
            priority: input.priority ?? 'MEDIUM',
            reporterId: access.userId,
            assigneeId: input.assigneeId ?? null,
            parentId: input.parentId ?? null,
            storyPoints: input.storyPoints ?? null,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            rank: await endOfColumn(tx, access.projectId),
          },
        });
        if (input.labelIds?.length) {
          await tx.issueLabel.createMany({
            data: [...new Set(input.labelIds)].map((labelId) => ({
              issueId: issue.id,
              labelId,
              projectId: access.projectId,
            })),
          });
        }
        await tx.issueActivity.create({
          data: {
            issueId: issue.id,
            actorId: access.userId,
            field: 'created',
            newValue: issue.key,
          },
        });
        await watch(tx, issue.id, [access.userId, issue.assigneeId]);
        if (issue.assigneeId && issue.assigneeId !== access.userId) {
          await outbox(tx, 'issue.assigned', issue.id, {
            issueId: issue.id,
            actorId: access.userId,
            assigneeId: issue.assigneeId,
          });
        }
        return toIssueDto(await load(tx, issue.id));
      });
    },

    /**
     * Field allow-list first (whole request 403 on any denied field), then hierarchy,
     * eligibility and the optimistic version check (FR-ISS-008).
     */
    async update(access: IssueAccess, input: UpdateIssueInput): Promise<IssueDto> {
      assertWritable(access);
      const { version, ...changes } = input;
      const fields = Object.keys(changes) as IssueField[];
      assertIssueFieldsAllowed(access, fields);

      return db.$transaction(async (tx) => {
        const current = await tx.issue.findUniqueOrThrow({
          where: { id: access.issueId },
          include: { children: { where: { deletedAt: null }, select: { type: true } } },
        });
        if (current.version !== version) {
          throw conflict(
            ErrorCode.VERSION_CONFLICT,
            'This issue was changed by someone else. Reload and try again.',
          );
        }

        const type = changes.type ?? current.type;
        const parentId = changes.parentId !== undefined ? changes.parentId : current.parentId;
        if (changes.type !== undefined || changes.parentId !== undefined) {
          if (parentId === current.id) throw invalidHierarchy('An issue cannot be its own parent');
          const parent = parentId ? await loadParent(tx, access.projectId, parentId) : null;
          const error =
            hierarchyError(type, parent?.type ?? null) ??
            childrenError(
              type,
              current.children.map((c) => c.type),
            );
          if (error) throw invalidHierarchy(error);
        }
        if (changes.assigneeId) await assertAssigneeEligible(tx, access, changes.assigneeId);

        const statusChanged = changes.status !== undefined && changes.status !== current.status;
        let rank: string | undefined;
        if (statusChanged) {
          // ADR-008: a status change appends to the end of the target column.
          await lockProject(tx, access.projectId);
          rank = await endOfColumn(tx, access.projectId, current.id);
        }

        const { count } = await tx.issue.updateMany({
          where: { id: current.id, version },
          data: {
            ...changes,
            dueAt:
              changes.dueAt === undefined
                ? undefined
                : changes.dueAt
                  ? new Date(changes.dueAt)
                  : null,
            ...(rank ? { rank } : {}),
            version: { increment: 1 },
          },
        });
        if (count === 0) {
          throw conflict(
            ErrorCode.VERSION_CONFLICT,
            'This issue was changed by someone else. Reload and try again.',
          );
        }

        const activity = TRACKED.flatMap((f) => {
          if (changes[f] === undefined) return [];
          const next = f === 'dueAt' && changes.dueAt ? new Date(changes.dueAt) : changes[f];
          const [oldValue, newValue] = [stringify(current[f]), stringify(next)];
          return oldValue === newValue
            ? []
            : [{ issueId: current.id, actorId: access.userId, field: f, oldValue, newValue }];
        });
        if (changes.description !== undefined && changes.description !== current.description) {
          // Description text is not copied into history (Architecture §4: minimise sensitive text).
          activity.push({
            issueId: current.id,
            actorId: access.userId,
            field: 'description',
            oldValue: null,
            newValue: null,
          });
        }
        if (activity.length > 0) await tx.issueActivity.createMany({ data: activity });

        if (changes.assigneeId) await watch(tx, current.id, [changes.assigneeId]);
        const notable = activity
          .filter((a) => a.field === 'status' || a.field === 'assigneeId')
          .map((a) => a.field);
        if (notable.length > 0) {
          await outbox(tx, 'issue.updated', current.id, {
            issueId: current.id,
            actorId: access.userId,
            fields: notable,
            // New assignee (null = unassigned) so delivery can send ASSIGNED, not just "updated".
            ...(notable.includes('assigneeId') ? { assigneeId: changes.assigneeId ?? null } : {}),
          });
        }
        return toIssueDto(await load(tx, current.id));
      });
    },

    async setLabels(access: IssueAccess, labelIds: string[]): Promise<IssueDto> {
      assertWritable(access);
      assertIssueFieldsAllowed(access, ['labels']);
      return db.$transaction(async (tx) => {
        await assertLabelsInProject(tx, access.projectId, labelIds);
        const before = await tx.issueLabel.findMany({
          where: { issueId: access.issueId },
          include: { label: { select: { name: true } } },
        });
        await tx.issueLabel.deleteMany({ where: { issueId: access.issueId } });
        if (labelIds.length > 0) {
          await tx.issueLabel.createMany({
            data: [...new Set(labelIds)].map((labelId) => ({
              issueId: access.issueId,
              labelId,
              projectId: access.projectId,
            })),
          });
        }
        const after = await tx.label.findMany({
          where: { id: { in: labelIds } },
          select: { name: true },
        });
        const oldValue = before
          .map((l) => l.label.name)
          .sort()
          .join(', ');
        const newValue = after
          .map((l) => l.name)
          .sort()
          .join(', ');
        if (oldValue !== newValue) {
          await tx.issueActivity.create({
            data: {
              issueId: access.issueId,
              actorId: access.userId,
              field: 'labels',
              oldValue: oldValue || null,
              newValue: newValue || null,
            },
          });
        }
        return toIssueDto(await load(tx, access.issueId));
      });
    },

    /** ADR-014: soft delete (PM+), leaving any PLANNED/ACTIVE sprint with history closed. */
    async softDelete(access: IssueAccess): Promise<void> {
      assertCan(access, 'softDeleteRestoreIssue');
      assertWritable(access);
      await db.$transaction(async (tx) => {
        const issue = await tx.issue.findUniqueOrThrow({
          where: { id: access.issueId },
          include: { sprint: { select: { status: true } } },
        });
        if (issue.deletedAt) throw conflict(ErrorCode.CONFLICT, 'Issue is already deleted');
        const leaveSprint =
          issue.sprint && (issue.sprint.status === 'PLANNED' || issue.sprint.status === 'ACTIVE');
        await tx.issue.update({
          where: { id: issue.id },
          data: {
            deletedAt: new Date(),
            deletedById: access.userId,
            version: { increment: 1 },
            ...(leaveSprint ? { sprintId: null } : {}),
          },
        });
        if (leaveSprint) {
          await tx.sprintIssueHistory.updateMany({
            where: { issueId: issue.id, sprintId: issue.sprintId!, removedAt: null },
            data: { removedAt: new Date() },
          });
        }
        await tx.issueActivity.create({
          data: { issueId: issue.id, actorId: access.userId, field: 'deleted' },
        });
      });
    },

    /** Restored issues return to the backlog (not in any sprint). */
    async restore(access: IssueAccess): Promise<IssueDto> {
      assertCan(access, 'softDeleteRestoreIssue');
      assertWritable(access);
      return db.$transaction(async (tx) => {
        const { count } = await tx.issue.updateMany({
          where: { id: access.issueId, deletedAt: { not: null } },
          data: { deletedAt: null, deletedById: null, sprintId: null, version: { increment: 1 } },
        });
        if (count === 0) throw conflict(ErrorCode.CONFLICT, 'Issue is not deleted');
        await tx.issueActivity.create({
          data: { issueId: access.issueId, actorId: access.userId, field: 'restored' },
        });
        return toIssueDto(await load(tx, access.issueId));
      });
    },

    async activity(access: IssueAccess): Promise<ActivityDto[]> {
      const rows = await db.issueActivity.findMany({
        where: { issueId: access.issueId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((a) => ({
        id: a.id,
        actor: a.actor,
        field: a.field,
        oldValue: a.oldValue,
        newValue: a.newValue,
        createdAt: a.createdAt.toISOString(),
      }));
    },

    /** ADR-010: any viewer may watch; the matrix still applies (e.g. read-only archived). */
    async watchers(access: IssueAccess) {
      const rows = await db.issueWatcher.findMany({
        where: { issueId: access.issueId },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return {
        watchers: rows.map((w) => w.user),
        watching: rows.some((w) => w.userId === access.userId),
      };
    },

    async setWatching(access: IssueAccess, watching: boolean) {
      assertCan(access, 'watchIssue');
      assertWritable(access);
      if (watching) {
        await db.issueWatcher.createMany({
          data: [{ issueId: access.issueId, userId: access.userId }],
          skipDuplicates: true,
        });
      } else {
        await db.issueWatcher.deleteMany({
          where: { issueId: access.issueId, userId: access.userId },
        });
      }
    },
  };
}

export type IssueService = ReturnType<typeof createIssueService>;
