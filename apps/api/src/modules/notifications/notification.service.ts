import type { NotificationDto, NotificationListDto, NotificationListQuery } from '@pm/shared';
import type { Notification, Prisma } from '@prisma/client';
import { notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import { assertId } from '../../policy/access.js';

type Row = Notification & { issue: { id: string; key: string; title: string } | null };

/**
 * FR-NTF-002: notifications are filtered by the caller's *current* authorization on every read.
 * Visible = ACTIVE membership of the workspace and, for Members, an ACTIVE project membership;
 * workspace-level notifications (invite accepted) only while Owner/Admin; never deleted issues.
 */
async function visibleWhere(db: Db, userId: string): Promise<Prisma.NotificationWhereInput> {
  const memberships = await db.workspaceMember.findMany({
    where: { userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { workspaceId: true, role: true },
  });
  const adminWs = memberships.filter((m) => m.role !== 'MEMBER').map((m) => m.workspaceId);
  const memberWs = memberships.filter((m) => m.role === 'MEMBER').map((m) => m.workspaceId);
  const projectIds = (
    await db.projectMember.findMany({
      where: { userId, status: 'ACTIVE', project: { workspaceId: { in: memberWs } } },
      select: { projectId: true },
    })
  ).map((p) => p.projectId);
  return {
    recipientId: userId,
    AND: [
      { OR: [{ issueId: null }, { issue: { deletedAt: null } }] },
      {
        OR: [
          { workspaceId: { in: adminWs } },
          { workspaceId: { in: memberWs }, projectId: { in: projectIds } },
        ],
      },
    ],
  };
}

const fieldsOf = (payload: unknown): string[] => {
  const f = (payload as { fields?: unknown } | null)?.fields;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
};
const actorIdOf = (payload: unknown): string | null => {
  const a = (payload as { actorId?: unknown } | null)?.actorId;
  return typeof a === 'string' ? a : null;
};

export function createNotificationService(db: Db) {
  async function toDtos(rows: Row[]): Promise<NotificationDto[]> {
    const actorIds = [...new Set(rows.map((r) => actorIdOf(r.payload)).filter((x) => x !== null))];
    const actors = new Map(
      (
        await db.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u]),
    );
    return rows.map((r) => {
      const actorId = actorIdOf(r.payload);
      return {
        id: r.id,
        type: r.type,
        workspaceId: r.workspaceId,
        projectId: r.projectId,
        issue: r.issue,
        actor: (actorId && actors.get(actorId)) || null,
        fields: fieldsOf(r.payload),
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** Updates one visible notification; anything else (other user, revoked access) is a 404. */
  async function setRead(userId: string, id: string, readAt: Date | null) {
    const where = await visibleWhere(db, userId);
    const { count } = await db.notification.updateMany({
      where: { ...where, id: assertId(id) },
      data: { readAt },
    });
    if (count === 0) throw notFound();
  }

  return {
    async list(userId: string, q: NotificationListQuery): Promise<NotificationListDto> {
      const where = { ...(await visibleWhere(db, userId)), ...(q.unread ? { readAt: null } : {}) };
      const [rows, total] = await Promise.all([
        db.notification.findMany({
          where,
          include: { issue: { select: { id: true, key: true, title: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        db.notification.count({ where }),
      ]);
      return { notifications: await toDtos(rows), total, page: q.page, pageSize: q.pageSize };
    },

    async unreadCount(userId: string): Promise<number> {
      return db.notification.count({
        where: { ...(await visibleWhere(db, userId)), readAt: null },
      });
    },

    markRead: (userId: string, id: string) => setRead(userId, id, new Date()),
    markUnread: (userId: string, id: string) => setRead(userId, id, null),

    async markAllRead(userId: string): Promise<void> {
      await db.notification.updateMany({
        where: { ...(await visibleWhere(db, userId)), readAt: null },
        data: { readAt: new Date() },
      });
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
