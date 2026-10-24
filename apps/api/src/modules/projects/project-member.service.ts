import { ErrorCode, type AddProjectMemberInput, type ProjectMemberDto } from '@pm/shared';
import type { ProjectRole } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import { assertId, type ProjectAccess } from '../../policy/access.js';
import { releaseUserIssues } from '../workspaces/member.service.js';

export function createProjectMemberService(db: Db) {
  async function findActive(access: ProjectAccess, memberId: string) {
    const member = await db.projectMember.findFirst({
      where: { id: assertId(memberId), projectId: access.projectId, status: 'ACTIVE' },
    });
    if (!member) throw notFound();
    return member;
  }

  return {
    async list(access: ProjectAccess): Promise<ProjectMemberDto[]> {
      const rows = await db.projectMember.findMany({
        where: { projectId: access.projectId, status: 'ACTIVE' },
        include: { user: { select: { name: true, avatarKey: true } } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      });
      return rows.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        avatarKey: m.user.avatarKey,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      }));
    },

    /**
     * FR-PRJ-003: only ACTIVE members of this project's workspace (else 422); a REMOVED row
     * is reactivated. Grants project roles only; workspace roles are never touched.
     */
    async add(access: ProjectAccess, input: AddProjectMemberInput) {
      const wsMember = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: access.workspaceId, userId: input.userId } },
      });
      if (wsMember?.status !== 'ACTIVE') {
        throw new AppError(
          422,
          ErrorCode.NOT_WORKSPACE_MEMBER,
          'Only active workspace members can join a project',
        );
      }
      return db.$transaction(async (tx) => {
        const existing = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: access.projectId, userId: input.userId } },
        });
        if (existing?.status === 'ACTIVE') {
          throw conflict(ErrorCode.ALREADY_MEMBER, 'Already a member of this project');
        }
        const member = existing
          ? await tx.projectMember.update({
              where: { id: existing.id },
              data: { status: 'ACTIVE', role: input.role, removedAt: null, joinedAt: new Date() },
            })
          : await tx.projectMember.create({
              data: { projectId: access.projectId, userId: input.userId, role: input.role },
            });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'project_member.added',
          targetType: 'ProjectMember',
          targetId: member.id,
          metadata: { projectId: access.projectId, userId: input.userId, role: input.role },
        });
      });
    },

    async changeRole(access: ProjectAccess, memberId: string, role: ProjectRole) {
      const member = await findActive(access, memberId);
      if (member.role === role) return;
      await db.$transaction(async (tx) => {
        await tx.projectMember.update({ where: { id: member.id }, data: { role } });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'project_member.role_changed',
          targetType: 'ProjectMember',
          targetId: member.id,
          metadata: { projectId: access.projectId, from: member.role, to: role },
        });
      });
    },

    /** ADR-012: revokes access, unassigns open issues and removes watches in this project. */
    async remove(access: ProjectAccess, memberId: string) {
      const member = await findActive(access, memberId);
      await db.$transaction(async (tx) => {
        await tx.projectMember.update({
          where: { id: member.id },
          data: { status: 'REMOVED', removedAt: new Date() },
        });
        const effects = await releaseUserIssues(
          tx,
          { projectId: access.projectId },
          member.userId,
          access.userId,
        );
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: access.userId,
          action: 'project_member.removed',
          targetType: 'ProjectMember',
          targetId: member.id,
          metadata: { projectId: access.projectId, userId: member.userId, ...effects },
        });
      });
    },
  };
}

export type ProjectMemberService = ReturnType<typeof createProjectMemberService>;
