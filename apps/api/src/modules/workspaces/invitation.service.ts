import {
  ErrorCode,
  type InvitationDto,
  type InvitationPreviewDto,
  type InviteInput,
} from '@pm/shared';
import { Prisma, type WorkspaceInvitation } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import type { Db } from '../../lib/prisma.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import {
  assertId,
  assertWorkspaceCan,
  assertWritable,
  resolveWorkspaceAccess,
  type WorkspaceAccess,
} from '../../policy/access.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type Tx = Prisma.TransactionClient;

const inactive = () =>
  new AppError(410, ErrorCode.INVITATION_INACTIVE, 'This invitation is no longer valid');

function toDto(inv: WorkspaceInvitation & { invitedBy: { name: string } }): InvitationDto {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    state: inv.state,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    invitedBy: inv.invitedBy.name,
  };
}

/** Lazy expiry (ADR-013); the hourly sweep in apps/worker (ADR-018) does the same in bulk. */
async function expireStale(tx: Tx | Db, where: Prisma.WorkspaceInvitationWhereInput) {
  await tx.workspaceInvitation.updateMany({
    where: { ...where, state: 'PENDING', expiresAt: { lte: new Date() } },
    data: { state: 'EXPIRED' },
  });
}

export function createInvitationService(db: Db, mailer: Mailer, appBaseUrl: string) {
  async function issue(tx: Tx, access: WorkspaceAccess, email: string, role: 'ADMIN' | 'MEMBER') {
    const token = newToken();
    const invitation = await tx.workspaceInvitation.create({
      data: {
        workspaceId: access.workspaceId,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: access.userId,
      },
      include: { invitedBy: { select: { name: true } }, workspace: { select: { name: true } } },
    });
    return { invitation, token };
  }

  async function sendInvite(to: string, workspaceName: string, inviter: string, token: string) {
    await mailer.send({
      to,
      subject: `${inviter} invited you to ${workspaceName}`,
      text: `Join ${workspaceName}: ${appBaseUrl}/invitations/accept?token=${token}\nThis invitation expires in 7 days.`,
    });
  }

  /** Invitations are managed by Owner/Admin only; Members cannot even see them (FR-TEN-008). */
  async function resolveManaged(userId: string, invitationId: string) {
    const invitation = await db.workspaceInvitation.findUnique({
      where: { id: assertId(invitationId) },
    });
    if (!invitation) throw notFound();
    const access = await resolveWorkspaceAccess(db, userId, invitation.workspaceId);
    if (access.workspaceRole === 'MEMBER') throw notFound();
    assertWritable(access);
    return { access, invitation };
  }

  return {
    async list(access: WorkspaceAccess): Promise<InvitationDto[]> {
      assertWorkspaceCan(access, 'manageWorkspaceSettingsAndInvites');
      await expireStale(db, { workspaceId: access.workspaceId });
      const rows = await db.workspaceInvitation.findMany({
        where: { workspaceId: access.workspaceId, state: 'PENDING' },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(toDto);
    },

    /** FR-TEN-002: ADMIN/MEMBER only, one PENDING per email, none while suspended. */
    async create(access: WorkspaceAccess, input: InviteInput): Promise<InvitationDto> {
      assertWorkspaceCan(access, 'manageWorkspaceSettingsAndInvites');
      assertWritable(access);
      const member = await db.workspaceMember.findFirst({
        where: { workspaceId: access.workspaceId, status: 'ACTIVE', user: { email: input.email } },
      });
      if (member) throw conflict(ErrorCode.ALREADY_MEMBER, 'That person is already a member');

      try {
        const { invitation, token } = await db.$transaction(async (tx) => {
          await expireStale(tx, { workspaceId: access.workspaceId, email: input.email });
          const result = await issue(tx, access, input.email, input.role);
          await writeAudit(tx, {
            workspaceId: access.workspaceId,
            actorId: access.userId,
            action: 'invitation.created',
            targetType: 'WorkspaceInvitation',
            targetId: result.invitation.id,
            metadata: { role: input.role },
          });
          return result;
        });
        await sendInvite(input.email, invitation.workspace.name, invitation.invitedBy.name, token);
        return toDto(invitation);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw conflict(
            ErrorCode.INVITE_EXISTS,
            'An invitation is already pending for that email',
          );
        }
        throw err;
      }
    },

    /** ADR-013: resend = revoke current + issue a new token in one transaction. */
    async resend(userId: string, invitationId: string): Promise<InvitationDto> {
      const { access, invitation } = await resolveManaged(userId, invitationId);
      const { invitation: next, token } = await db.$transaction(async (tx) => {
        await expireStale(tx, { id: invitation.id });
        const { count } = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, state: 'PENDING' },
          data: { state: 'REVOKED', revokedAt: new Date(), revokedById: userId },
        });
        if (count === 0) throw inactive();
        const result = await issue(tx, access, invitation.email, invitation.role);
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: userId,
          action: 'invitation.resent',
          targetType: 'WorkspaceInvitation',
          targetId: result.invitation.id,
          metadata: { replaces: invitation.id },
        });
        return result;
      });
      await sendInvite(next.email, next.workspace.name, next.invitedBy.name, token);
      return toDto(next);
    },

    async revoke(userId: string, invitationId: string): Promise<void> {
      const { access, invitation } = await resolveManaged(userId, invitationId);
      await db.$transaction(async (tx) => {
        await expireStale(tx, { id: invitation.id });
        const { count } = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, state: 'PENDING' },
          data: { state: 'REVOKED', revokedAt: new Date(), revokedById: userId },
        });
        if (count === 0) throw inactive();
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: userId,
          action: 'invitation.revoked',
          targetType: 'WorkspaceInvitation',
          targetId: invitation.id,
        });
      });
    },

    /** Public: the token holder sees where they are invited before signing in. */
    async preview(token: string): Promise<InvitationPreviewDto> {
      const tokenHash = hashToken(token);
      await expireStale(db, { tokenHash });
      const inv = await db.workspaceInvitation.findUnique({
        where: { tokenHash },
        include: { workspace: true, invitedBy: { select: { name: true } } },
      });
      if (!inv || inv.state !== 'PENDING' || inv.workspace.status !== 'ACTIVE') throw inactive();
      return {
        workspaceName: inv.workspace.name,
        invitedBy: inv.invitedBy.name,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt.toISOString(),
      };
    },

    /**
     * FR-TEN-003: verified caller email must equal the invitation email. Creates the member
     * or reactivates a REMOVED one; project memberships are not restored (ADR-012).
     */
    async accept(userId: string, token: string): Promise<{ workspaceId: string }> {
      const tokenHash = hashToken(token);
      return db.$transaction(async (tx) => {
        await expireStale(tx, { tokenHash });
        const inv = await tx.workspaceInvitation.findUnique({
          where: { tokenHash },
          include: { workspace: { select: { status: true } } },
        });
        if (!inv || inv.state !== 'PENDING') throw inactive();
        if (inv.workspace.status === 'SUSPENDED') {
          throw forbidden(ErrorCode.WORKSPACE_SUSPENDED, 'Workspace is suspended');
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (!user.verifiedAt || user.email !== inv.email) {
          throw forbidden(
            ErrorCode.INVITATION_EMAIL_MISMATCH,
            'This invitation was sent to a different email address',
          );
        }
        const existing = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId } },
        });
        if (existing?.status === 'ACTIVE') {
          throw conflict(ErrorCode.ALREADY_MEMBER, 'You are already a member of this workspace');
        }

        const { count } = await tx.workspaceInvitation.updateMany({
          where: { id: inv.id, state: 'PENDING' },
          data: { state: 'ACCEPTED', acceptedAt: new Date(), acceptedById: userId },
        });
        if (count === 0) throw inactive();

        const member = existing
          ? await tx.workspaceMember.update({
              where: { id: existing.id },
              data: { status: 'ACTIVE', role: inv.role, removedAt: null, joinedAt: new Date() },
            })
          : await tx.workspaceMember.create({
              data: { workspaceId: inv.workspaceId, userId, role: inv.role },
            });
        await writeAudit(tx, {
          workspaceId: inv.workspaceId,
          actorId: userId,
          action: 'invitation.accepted',
          targetType: 'WorkspaceMember',
          targetId: member.id,
          metadata: { invitationId: inv.id, role: inv.role, reactivated: existing !== null },
        });
        return { workspaceId: inv.workspaceId };
      });
    },
  };
}

export type InvitationService = ReturnType<typeof createInvitationService>;
