import { COMMENT_EDIT_WINDOW_MS, ErrorCode, parseMentions, type CommentDto } from '@pm/shared';
import type { IssueComment, Prisma } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import {
  assertCan,
  assertId,
  assertWritable,
  resolveIssueAccess,
  type IssueAccess,
} from '../../policy/access.js';

type Row = IssueComment & { author: { id: string; name: string } };

/** ADR-014: a removed comment's body never leaves the API. */
function toDto(c: Row): CommentDto {
  return {
    id: c.id,
    author: c.author,
    body: c.deletedAt ? null : c.body,
    removed: c.deletedAt !== null,
    moderated: c.moderationReason !== null,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt?.toISOString() ?? null,
  };
}

const include = { author: { select: { id: true, name: true } } } as const;

/**
 * FR-ISS-005: only mentioned users who can view the issue are notified — ACTIVE workspace
 * Owner/Admin, or ACTIVE members of this project. Others are silently ignored.
 */
async function eligibleMentions(
  tx: Prisma.TransactionClient,
  access: IssueAccess,
  emails: string[],
) {
  if (emails.length === 0) return [];
  const members = await tx.workspaceMember.findMany({
    where: {
      workspaceId: access.workspaceId,
      status: 'ACTIVE',
      user: { email: { in: emails }, status: 'ACTIVE' },
      OR: [
        { role: { in: ['OWNER', 'ADMIN'] } },
        { user: { projectMembers: { some: { projectId: access.projectId, status: 'ACTIVE' } } } },
      ],
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId).filter((id) => id !== access.userId);
}

export function createCommentService(db: Db) {
  /** Comment → Issue → Project → Workspace ancestry; invisible comments are 404. */
  async function resolve(userId: string, commentId: string) {
    const comment = await db.issueComment.findUnique({
      where: { id: assertId(commentId) },
      include,
    });
    if (!comment) throw notFound();
    const access = await resolveIssueAccess(db, userId, comment.issueId);
    return { comment, access };
  }

  return {
    resolve,

    async list(access: IssueAccess): Promise<CommentDto[]> {
      const rows = await db.issueComment.findMany({
        where: { issueId: access.issueId },
        include,
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toDto);
    },

    async create(access: IssueAccess, body: string): Promise<CommentDto> {
      assertCan(access, 'commentAndAttach');
      assertWritable(access);
      return db.$transaction(async (tx) => {
        const comment = await tx.issueComment.create({
          data: { issueId: access.issueId, authorId: access.userId, body },
          include,
        });
        const recipientIds = await eligibleMentions(tx, access, parseMentions(body));
        // Delivery (in-app/email) is the G4 worker's job; the event is written atomically here.
        await tx.outboxEvent.create({
          data: {
            topic: 'issue.commented',
            aggregateId: access.issueId,
            payload: {
              issueId: access.issueId,
              commentId: comment.id,
              actorId: access.userId,
              mentionedUserIds: recipientIds,
            },
          },
        });
        return toDto(comment);
      });
    },

    /** Author only, within 15 minutes of posting. */
    async edit(userId: string, commentId: string, body: string): Promise<CommentDto> {
      const { comment, access } = await resolve(userId, commentId);
      assertWritable(access);
      if (comment.deletedAt) throw notFound();
      if (comment.authorId !== userId) throw forbidden();
      if (Date.now() - comment.createdAt.getTime() > COMMENT_EDIT_WINDOW_MS) {
        throw forbidden(
          ErrorCode.COMMENT_EDIT_WINDOW_CLOSED,
          'Comments can only be edited for 15 minutes',
        );
      }
      const updated = await db.issueComment.update({
        where: { id: comment.id },
        data: { body, editedAt: new Date() },
        include,
      });
      return toDto(updated);
    },

    /** Authors may soft-delete their own comment at any time; others must moderate. */
    async deleteOwn(userId: string, commentId: string) {
      const { comment, access } = await resolve(userId, commentId);
      assertWritable(access);
      if (comment.deletedAt) throw notFound();
      if (comment.authorId !== userId) throw forbidden();
      await db.issueComment.update({
        where: { id: comment.id },
        data: { deletedAt: new Date(), deletedById: userId },
      });
    },

    /** Owner/Admin/PM remove any comment with a mandatory reason, recorded in AuditLog. */
    async moderate(userId: string, commentId: string, reason: string) {
      const { comment, access } = await resolve(userId, commentId);
      assertCan(access, 'moderateComments');
      assertWritable(access);
      if (comment.deletedAt)
        throw new AppError(409, ErrorCode.CONFLICT, 'Comment is already removed');
      await db.$transaction(async (tx) => {
        await tx.issueComment.update({
          where: { id: comment.id },
          data: { deletedAt: new Date(), deletedById: userId, moderationReason: reason },
        });
        await writeAudit(tx, {
          workspaceId: access.workspaceId,
          actorId: userId,
          action: 'comment.moderated',
          targetType: 'IssueComment',
          targetId: comment.id,
          metadata: { issueId: comment.issueId, authorId: comment.authorId, reason },
        });
      });
    },
  };
}

export type CommentService = ReturnType<typeof createCommentService>;
