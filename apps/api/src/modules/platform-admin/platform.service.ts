import {
  ErrorCode,
  type PlatformAuditEntryDto,
  type PlatformAuditQuery,
  type PlatformMetricsDto,
  type PlatformUserQuery,
  type PlatformWorkspaceDto,
  type PlatformWorkspaceQuery,
} from '@pm/shared';
import type { AuditLog, Prisma } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import { assertId } from '../../policy/access.js';

/**
 * FR-ADM-002…004. Every query here reads tenant *metadata* (names, statuses, counts) and never
 * issues, comments, attachments, credentials or tokens (FR-ADM-003, ADR-007).
 */

const workspaceSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  suspendedAt: true,
  timezone: true,
  createdAt: true,
  _count: {
    select: {
      members: { where: { status: 'ACTIVE' as const } },
      projects: { where: { archivedAt: null } },
    },
  },
  members: {
    where: { role: 'OWNER' as const, status: 'ACTIVE' as const },
    select: { user: { select: { id: true, name: true } } },
    take: 1,
  },
} satisfies Prisma.WorkspaceSelect;

type WorkspaceRow = Prisma.WorkspaceGetPayload<{ select: typeof workspaceSelect }>;

function toWorkspaceDto(w: WorkspaceRow): PlatformWorkspaceDto {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    status: w.status,
    suspendedAt: w.suspendedAt?.toISOString() ?? null,
    timezone: w.timezone,
    createdAt: w.createdAt.toISOString(),
    activeMembers: w._count.members,
    projects: w._count.projects,
    owner: w.members[0]?.user ?? null,
  };
}

type AuditRow = AuditLog & {
  actor: { id: string; name: string } | null;
  workspace: { id: string; name: string } | null;
};
const auditInclude = {
  actor: { select: { id: true, name: true } },
  workspace: { select: { id: true, name: true } },
} as const;

function toAuditDto(a: AuditRow): PlatformAuditEntryDto {
  return {
    id: a.id,
    action: a.action,
    actorType: a.actorType,
    actor: a.actor,
    workspace: a.workspace,
    targetType: a.targetType,
    targetId: a.targetId,
    // Tenant audit metadata can describe tenant activity; only platform actions are shown.
    metadata:
      a.actorType === 'PLATFORM_ADMIN' ? ((a.metadata ?? {}) as Record<string, unknown>) : null,
    createdAt: a.createdAt.toISOString(),
  };
}

const paging = (q: { page: number; pageSize: number }) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});

export function createPlatformService(db: Db) {
  async function setStatus(
    adminUserId: string,
    workspaceId: string,
    suspend: boolean,
    reason: string,
  ) {
    return db.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({ where: { id: assertId(workspaceId) } });
      if (!ws) throw notFound();
      const target = suspend ? 'SUSPENDED' : 'ACTIVE';
      const { count } = await tx.workspace.updateMany({
        where: { id: ws.id, status: suspend ? 'ACTIVE' : 'SUSPENDED' },
        data: { status: target, suspendedAt: suspend ? new Date() : null },
      });
      if (count === 0) {
        throw conflict(
          ErrorCode.CONFLICT,
          suspend ? 'Workspace is already suspended' : 'Workspace is not suspended',
        );
      }
      await writeAudit(tx, {
        workspaceId: ws.id,
        actorId: adminUserId,
        actorType: 'PLATFORM_ADMIN',
        action: suspend ? 'workspace.suspended' : 'workspace.reactivated',
        targetType: 'Workspace',
        targetId: ws.id,
        metadata: { reason },
      });
      return toWorkspaceDto(
        await tx.workspace.findUniqueOrThrow({ where: { id: ws.id }, select: workspaceSelect }),
      );
    });
  }

  return {
    async listWorkspaces(q: PlatformWorkspaceQuery) {
      const where: Prisma.WorkspaceWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { slug: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.workspace.findMany({
          where,
          select: workspaceSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...paging(q),
        }),
        db.workspace.count({ where }),
      ]);
      return { workspaces: rows.map(toWorkspaceDto), total, page: q.page, pageSize: q.pageSize };
    },

    async getWorkspace(workspaceId: string) {
      const ws = await db.workspace.findUnique({
        where: { id: assertId(workspaceId) },
        select: workspaceSelect,
      });
      if (!ws) throw notFound();
      const [archivedProjects, pendingInvitations, history] = await Promise.all([
        db.project.count({ where: { workspaceId: ws.id, archivedAt: { not: null } } }),
        db.workspaceInvitation.count({ where: { workspaceId: ws.id, state: 'PENDING' } }),
        db.auditLog.findMany({
          where: {
            workspaceId: ws.id,
            action: { in: ['workspace.suspended', 'workspace.reactivated'] },
          },
          include: auditInclude,
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);
      return {
        workspace: { ...toWorkspaceDto(ws), archivedProjects, pendingInvitations },
        statusHistory: history.map(toAuditDto),
      };
    },

    suspend: (adminUserId: string, wid: string, reason: string) =>
      setStatus(adminUserId, wid, true, reason),
    reactivate: (adminUserId: string, wid: string, reason: string) =>
      setStatus(adminUserId, wid, false, reason),

    /** Read-only account metadata; no password hashes, tokens or sessions are ever selected. */
    async listUsers(q: PlatformUserQuery) {
      const where: Prisma.UserWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { email: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.user.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            verifiedAt: true,
            createdAt: true,
            platformAdmin: { select: { status: true } },
            _count: {
              select: {
                workspaceMembers: { where: { status: 'ACTIVE', workspace: { status: 'ACTIVE' } } },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...paging(q),
        }),
        db.user.count({ where }),
      ]);
      return {
        users: rows.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          status: u.status,
          emailVerified: u.verifiedAt !== null,
          platformAdmin: u.platformAdmin?.status === 'ACTIVE',
          activeWorkspaces: u._count.workspaceMembers,
          createdAt: u.createdAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    /** FR-NTF-003 audit trail across the platform, newest first. */
    async listAudit(q: PlatformAuditQuery) {
      const where: Prisma.AuditLogWhereInput = {
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}),
        ...(q.actorType ? { actorType: q.actorType } : {}),
      };
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          include: auditInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...paging(q),
        }),
        db.auditLog.count({ where }),
      ]);
      return { entries: rows.map(toAuditDto), total, page: q.page, pageSize: q.pageSize };
    },

    /** FR-ADM-004: aggregate counts and job health only. */
    async metrics(): Promise<PlatformMetricsDto> {
      const [byStatus, users, activeUsers, activeMembers, jobs, retrying, oldest] =
        await Promise.all([
          db.workspace.groupBy({ by: ['status'], _count: { _all: true } }),
          db.user.count(),
          db.user.count({ where: { status: 'ACTIVE' } }),
          db.user.count({
            where: {
              status: 'ACTIVE',
              workspaceMembers: { some: { status: 'ACTIVE', workspace: { status: 'ACTIVE' } } },
            },
          }),
          db.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
          db.outboxEvent.count({ where: { status: 'PENDING', attempts: { gt: 0 } } }),
          db.outboxEvent.findFirst({
            where: { status: 'PENDING' },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
        ]);
      const ws = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
      const job = (s: string) => jobs.find((b) => b.status === s)?._count._all ?? 0;
      return {
        workspaces: {
          total: ws('ACTIVE') + ws('SUSPENDED'),
          active: ws('ACTIVE'),
          suspended: ws('SUSPENDED'),
        },
        users: { total: users, active: activeUsers },
        activeMembers,
        jobs: {
          pending: job('PENDING'),
          dead: job('DEAD'),
          retrying,
          oldestPendingAt: oldest?.createdAt.toISOString() ?? null,
        },
      };
    },
  };
}

export type PlatformService = ReturnType<typeof createPlatformService>;
