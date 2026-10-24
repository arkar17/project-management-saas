import {
  ErrorCode,
  addDays,
  computeProjectOverview,
  localDate,
  type CreateProjectInput,
  type ProjectDto,
  type ProjectListDto,
  type ProjectListQuery,
  type ProjectOverviewDto,
  type UpdateProjectInput,
} from '@pm/shared';
import { Prisma, type Project } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import type { ProjectAccess, WorkspaceAccess } from '../../policy/access.js';
import { tenantActor, type Actor } from '@pm/shared';

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`) : d);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toProjectDto(p: Project, myAccess: Actor): ProjectDto {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    key: p.key,
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: fromDate(p.startDate),
    targetDate: fromDate(p.targetDate),
    archivedAt: p.archivedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    myAccess,
  };
}

const dateOrder = () =>
  new AppError(422, ErrorCode.VALIDATION_ERROR, 'Start date must be on or before the target date', [
    { path: 'targetDate', message: 'Start date must be on or before the target date' },
  ]);

export function createProjectService(db: Db) {
  return {
    /** FR-PRJ-001: Owner/Admin only (checked by the route); key unique per workspace. */
    async create(access: WorkspaceAccess, input: CreateProjectInput): Promise<ProjectDto> {
      try {
        return await db.$transaction(async (tx) => {
          const project = await tx.project.create({
            data: {
              workspaceId: access.workspaceId,
              key: input.key,
              name: input.name,
              description: input.description ?? null,
              // SRS FR-PRJ-001 default ACTIVE (also the DB default since GAP-02).
              status: input.status,
              startDate: toDate(input.startDate) ?? null,
              targetDate: toDate(input.targetDate) ?? null,
              createdById: access.userId,
            },
          });
          await writeAudit(tx, {
            workspaceId: access.workspaceId,
            actorId: access.userId,
            action: 'project.created',
            targetType: 'Project',
            targetId: project.id,
            metadata: { key: project.key },
          });
          return toProjectDto(project, tenantActor(access.workspaceRole, null));
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw conflict(
            ErrorCode.PROJECT_KEY_TAKEN,
            'That project key is already used in this workspace',
          );
        }
        throw err;
      }
    },

    /** FR-PRJ-002: Owner/Admin see every project; others only their ACTIVE memberships. */
    async list(access: WorkspaceAccess, query: ProjectListQuery): Promise<ProjectListDto> {
      const isAdmin = access.workspaceRole !== 'MEMBER';
      const where: Prisma.ProjectWhereInput = {
        workspaceId: access.workspaceId,
        ...(isAdmin ? {} : { members: { some: { userId: access.userId, status: 'ACTIVE' } } }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.archived === 'active' ? { archivedAt: null } : {}),
        ...(query.archived === 'archived' ? { archivedAt: { not: null } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { key: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.project.findMany({
          where,
          include: {
            members: { where: { userId: access.userId, status: 'ACTIVE' }, select: { role: true } },
          },
          orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.project.count({ where }),
      ]);
      return {
        projects: rows.map((p) =>
          toProjectDto(p, tenantActor(access.workspaceRole, p.members[0]?.role ?? null)),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async get(access: ProjectAccess): Promise<ProjectDto> {
      const project = await db.project.findUniqueOrThrow({ where: { id: access.projectId } });
      return toProjectDto(project, access.actor);
    },

    /** Key and workspace are immutable; dates are re-checked against stored values. */
    async update(access: ProjectAccess, input: UpdateProjectInput): Promise<ProjectDto> {
      return db.$transaction(async (tx) => {
        const before = await tx.project.findUniqueOrThrow({ where: { id: access.projectId } });
        const start = input.startDate !== undefined ? input.startDate : fromDate(before.startDate);
        const target =
          input.targetDate !== undefined ? input.targetDate : fromDate(before.targetDate);
        if (start && target && start > target) throw dateOrder();

        const project = await tx.project.update({
          where: { id: access.projectId },
          data: {
            ...input,
            startDate: toDate(input.startDate),
            targetDate: toDate(input.targetDate),
          },
        });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'project.updated',
          targetType: 'Project',
          targetId: project.id,
          metadata: { fields: Object.keys(input) },
        });
        return toProjectDto(project, access.actor);
      });
    },

    /** FR-PRJ-004: archival is independent of status; both directions audited. */
    async setArchived(access: ProjectAccess, archived: boolean): Promise<ProjectDto> {
      return db.$transaction(async (tx) => {
        const { count } = await tx.project.updateMany({
          where: { id: access.projectId, archivedAt: archived ? null : { not: null } },
          data: archived
            ? { archivedAt: new Date(), archivedById: access.userId }
            : { archivedAt: null, archivedById: null },
        });
        if (count === 0) {
          throw archived
            ? conflict(ErrorCode.PROJECT_ARCHIVED, 'Project is already archived')
            : conflict(ErrorCode.PROJECT_NOT_ARCHIVED, 'Project is not archived');
        }
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: archived ? 'project.archived' : 'project.unarchived',
          targetType: 'Project',
          targetId: access.projectId,
        });
        const project = await tx.project.findUniqueOrThrow({ where: { id: access.projectId } });
        return toProjectDto(project, access.actor);
      });
    },

    /** FR-PRJ-005 overview; soft-deleted issues are excluded from every metric. */
    async overview(access: ProjectAccess, now = new Date()): Promise<ProjectOverviewDto> {
      const [issues, memberCount, activeSprint, workspace] = await Promise.all([
        db.issue.findMany({
          where: { projectId: access.projectId, deletedAt: null },
          select: { status: true, dueAt: true, type: true, priority: true },
        }),
        db.projectMember.count({ where: { projectId: access.projectId, status: 'ACTIVE' } }),
        db.sprint.findFirst({
          where: { projectId: access.projectId, status: 'ACTIVE' },
          select: { id: true, name: true, endAt: true },
        }),
        db.workspace.findUniqueOrThrow({
          where: { id: access.workspaceId },
          select: { timezone: true },
        }),
      ]);
      const count = (key: 'type' | 'priority') => {
        const out: Record<string, number> = {};
        for (const i of issues) out[i[key]] = (out[i[key]] ?? 0) + 1;
        return out;
      };
      const today = localDate(now, workspace.timezone);
      return {
        ...computeProjectOverview(issues, now, workspace.timezone),
        byType: count('type'),
        byPriority: count('priority'),
        range: { timezone: workspace.timezone, from: today, to: addDays(today, 7) },
        memberCount,
        activeSprint: activeSprint
          ? {
              id: activeSprint.id,
              name: activeSprint.name,
              endAt: activeSprint.endAt.toISOString(),
            }
          : null,
      };
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;
