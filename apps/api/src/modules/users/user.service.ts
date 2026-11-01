import { ErrorCode, type ChangePasswordInput, type UpdatePreferencesInput } from '@pm/shared';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { Db } from '../../lib/prisma.js';
import { removeFromWorkspace } from '../workspaces/member.service.js';

const wrongPassword = () => new AppError(403, ErrorCode.FORBIDDEN, 'Current password is incorrect');

/** FR-AUTH-004 self-service. The caller is always the session user; no user id is accepted. */
export function createUserService(db: Db) {
  async function assertPassword(userId: string, password: string) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, password))) throw wrongPassword();
    return user;
  }

  return {
    async updatePreferences(userId: string, input: UpdatePreferencesInput) {
      return db.user.update({ where: { id: userId }, data: input });
    },

    /** Other sessions of this user (APP and PLATFORM) are revoked; the current one stays. */
    async changePassword(userId: string, sessionId: string, input: ChangePasswordInput) {
      await assertPassword(userId, input.currentPassword);
      const passwordHash = await hashPassword(input.newPassword);
      await db.$transaction([
        db.user.update({ where: { id: userId }, data: { passwordHash } }),
        db.session.updateMany({
          where: { userId, revokedAt: null, id: { not: sessionId } },
          data: { revokedAt: new Date() },
        }),
      ]);
    },

    /**
     * Blocked while the user is an ACTIVE Owner of any workspace (409 OWNER_PROTECTED). Otherwise,
     * in one transaction: every ACTIVE membership goes through the FR-TEN-004 removal cascade
     * (ADR-012), every session is revoked and the user is DEACTIVATED. History is kept.
     */
    async deactivate(userId: string, password: string) {
      await assertPassword(userId, password);
      await db.$transaction(async (tx) => {
        const memberships = await tx.workspaceMember.findMany({
          where: { userId, status: 'ACTIVE' },
          select: { id: true, workspaceId: true, role: true },
        });
        if (memberships.some((m) => m.role === 'OWNER')) {
          throw conflict(
            ErrorCode.OWNER_PROTECTED,
            'Transfer ownership of your workspaces before deactivating your account',
          );
        }
        for (const m of memberships) {
          const effects = await removeFromWorkspace(tx, m.workspaceId, userId, userId);
          await writeAudit(tx, {
            workspaceId: m.workspaceId,
            actorId: userId,
            action: 'member.removed',
            targetType: 'WorkspaceMember',
            targetId: m.id,
            metadata: { userId, role: m.role, reason: 'account.deactivated', ...effects },
          });
        }
        const now = new Date();
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        });
        // Lock out further deactivation races: only an ACTIVE user is changed.
        const { count } = await tx.user.updateMany({
          where: { id: userId, status: 'ACTIVE' },
          data: { status: 'DEACTIVATED', deactivatedAt: now },
        });
        if (count === 0) throw conflict(ErrorCode.CONFLICT, 'Account is already deactivated');
      });
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
