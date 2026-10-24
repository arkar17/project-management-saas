import { ErrorCode, type MemberDto } from '@pm/shared';
import type { Prisma, WorkspaceRole } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import { assertId, assertWorkspaceCan, type WorkspaceAccess } from '../../policy/access.js';

type Tx = Prisma.TransactionClient;

/** ADR-012 removal cascade, shared with FR-AUTH-004 self-deactivation later. */
export async function removeFromWorkspace(
  tx: Tx,
  workspaceId: string,
  userId: string,
  actorId: string,
) {
  const now = new Date();
  await tx.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId, userId } },
    data: { status: 'REMOVED', removedAt: now },
  });
  const { count: projectMemberships } = await tx.projectMember.updateMany({
    where: { userId, status: 'ACTIVE', project: { workspaceId } },
    data: { status: 'REMOVED', removedAt: now },
  });

  const openIssues = await tx.issue.findMany({
    where: { workspaceId, assigneeId: userId, deletedAt: null, status: { not: 'DONE' } },
    select: { id: true },
  });
  if (openIssues.length > 0) {
    await tx.issue.updateMany({
      where: { id: { in: openIssues.map((i) => i.id) } },
      data: { assigneeId: null, version: { increment: 1 } },
    });
    await tx.issueActivity.createMany({
      data: openIssues.map((i) => ({
        issueId: i.id,
        actorId,
        field: 'assigneeId',
        oldValue: userId,
        newValue: null,
      })),
    });
  }
  const { count: watches } = await tx.issueWatcher.deleteMany({
    where: { userId, issue: { workspaceId } },
  });
  return { projectMemberships, unassignedIssues: openIssues.length, watches };
}

export function createMemberService(db: Db) {
  /** Resolves an ACTIVE member of the caller's workspace; anything else is invisible (404). */
  async function findTarget(tx: Tx | Db, access: WorkspaceAccess, memberId: string) {
    const target = await tx.workspaceMember.findFirst({
      where: { id: assertId(memberId), workspaceId: access.workspaceId, status: 'ACTIVE' },
      include: { user: { select: { verifiedAt: true } } },
    });
    if (!target) throw notFound();
    return target;
  }

  /** Admins cannot touch the Owner (403); the Owner cannot demote/remove themselves (409). */
  function assertMayManage(access: WorkspaceAccess, targetRole: WorkspaceRole) {
    const targetIsOwner = targetRole === 'OWNER';
    assertWorkspaceCan(access, 'manageWorkspaceMembers', { targetIsOwner });
    if (targetIsOwner) {
      throw conflict(ErrorCode.OWNER_PROTECTED, 'Transfer ownership before changing the Owner');
    }
  }

  return {
    /** FR-TEN-008: everyone sees names/avatars/roles; emails only for Owner/Admin. */
    async list(access: WorkspaceAccess): Promise<MemberDto[]> {
      const showEmail = access.workspaceRole !== 'MEMBER';
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: access.workspaceId, status: 'ACTIVE' },
        include: { user: { select: { name: true, email: true, avatarKey: true } } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      });
      return members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        avatarKey: m.user.avatarKey,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        ...(showEmail ? { email: m.user.email } : {}),
      }));
    },

    async changeRole(access: WorkspaceAccess, memberId: string, role: 'ADMIN' | 'MEMBER') {
      return db.$transaction(async (tx) => {
        const target = await findTarget(tx, access, memberId);
        assertMayManage(access, target.role);
        if (target.role === role) return;
        await tx.workspaceMember.update({ where: { id: target.id }, data: { role } });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'member.role_changed',
          targetType: 'WorkspaceMember',
          targetId: target.id,
          metadata: { userId: target.userId, from: target.role, to: role },
        });
      });
    },

    /** FR-TEN-004 / ADR-012: one transaction; history (comments, activity, audit) is kept. */
    async remove(access: WorkspaceAccess, memberId: string) {
      return db.$transaction(async (tx) => {
        const target = await findTarget(tx, access, memberId);
        assertMayManage(access, target.role);
        const effects = await removeFromWorkspace(
          tx,
          access.workspaceId,
          target.userId,
          access.userId,
        );
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'member.removed',
          targetType: 'WorkspaceMember',
          targetId: target.id,
          metadata: { userId: target.userId, role: target.role, ...effects },
        });
      });
    },

    /**
     * FR-TEN-006: the workspace row is locked so concurrent transfers serialise; the loser
     * re-reads its role inside the lock and is refused (TC-TEN-006-2).
     */
    async transferOwnership(access: WorkspaceAccess, memberId: string) {
      assertWorkspaceCan(access, 'transferOwnership');
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${access.workspaceId}::uuid FOR UPDATE`;
        const caller = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: access.workspaceId, userId: access.userId } },
        });
        if (caller?.status !== 'ACTIVE' || caller.role !== 'OWNER') throw forbidden();

        const target = await tx.workspaceMember.findFirst({
          where: { id: memberId, workspaceId: access.workspaceId, status: 'ACTIVE' },
          include: { user: { select: { verifiedAt: true } } },
        });
        if (!target || target.id === caller.id) {
          throw new AppError(422, ErrorCode.NOT_WORKSPACE_MEMBER, 'Choose another active member');
        }
        if (!target.user.verifiedAt) {
          throw new AppError(
            422,
            ErrorCode.VALIDATION_ERROR,
            'The new Owner must have a verified email',
          );
        }

        // Demote first: the partial unique index allows only one ACTIVE OWNER at any instant.
        await tx.workspaceMember.update({ where: { id: caller.id }, data: { role: 'ADMIN' } });
        await tx.workspaceMember.update({ where: { id: target.id }, data: { role: 'OWNER' } });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'workspace.ownership_transferred',
          targetType: 'Workspace',
          targetId: access.workspaceId,
          metadata: { fromUserId: caller.userId, toUserId: target.userId },
        });
      });
    },
  };
}

export type MemberService = ReturnType<typeof createMemberService>;
