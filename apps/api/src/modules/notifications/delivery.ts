import type { NotificationType, OutboxEvent, Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { Mailer } from '../../lib/mailer.js';
import { EmailTopic } from '../../lib/outbox.js';
import type { Db } from '../../lib/prisma.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import { resolveIssueAccess, resolveWorkspaceAccess } from '../../policy/access.js';

export interface DeliveryDeps {
  db: Db;
  mailer: Mailer;
  appBaseUrl: string;
}

export type Handler = (event: OutboxEvent, deps: DeliveryDeps) => Promise<void>;

type Payload = Record<string, unknown>;
const payloadOf = (e: OutboxEvent) => (e.payload ?? {}) as Payload;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const strs = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Treat "hidden" (404) as "not a recipient"; any other failure is retried. */
async function visible<T>(check: () => Promise<T>): Promise<T | null> {
  try {
    return await check();
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Re-authorizes each recipient at delivery (ADR-005): an ACTIVE user who can still view the
 * issue right now. Removed members, revoked project access and soft-deleted issues all drop out.
 */
async function issueRecipients(db: Db, issueId: string, candidates: Iterable<string>) {
  const ids = [...new Set(candidates)];
  const active = new Set(
    (
      await db.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true } })
    ).map((u) => u.id),
  );
  const out: { userId: string; workspaceId: string; projectId: string }[] = [];
  for (const userId of ids) {
    if (!active.has(userId)) continue;
    const access = await visible(() => resolveIssueAccess(db, userId, issueId));
    if (access) out.push({ userId, workspaceId: access.workspaceId, projectId: access.projectId });
  }
  return out;
}

/** ADR-005 dedupe: topic:entityId:recipientId:eventId, inserted with ON CONFLICT DO NOTHING. */
async function notify(
  db: Db,
  event: OutboxEvent,
  type: NotificationType,
  issueId: string,
  recipients: { userId: string; workspaceId: string; projectId: string }[],
  payload: Prisma.InputJsonObject,
) {
  if (recipients.length === 0) return;
  await db.notification.createMany({
    data: recipients.map((r) => ({
      recipientId: r.userId,
      workspaceId: r.workspaceId,
      projectId: r.projectId,
      issueId,
      type,
      payload,
      dedupeKey: `${event.topic}:${issueId}:${r.userId}:${event.id}`,
    })),
    skipDuplicates: true,
  });
}

async function liveIssue(db: Db, issueId: string | null) {
  if (!issueId) return null;
  return db.issue.findFirst({ where: { id: issueId, deletedAt: null }, select: { id: true } });
}

async function watcherIds(db: Db, issueId: string) {
  return (await db.issueWatcher.findMany({ where: { issueId }, select: { userId: true } })).map(
    (w) => w.userId,
  );
}

const issueAssigned: Handler = async (event, { db }) => {
  const p = payloadOf(event);
  const issue = await liveIssue(db, str(p.issueId));
  const actorId = str(p.actorId);
  const assigneeId = str(p.assigneeId);
  if (!issue || !assigneeId || assigneeId === actorId) return;
  const to = await issueRecipients(db, issue.id, [assigneeId]);
  await notify(db, event, 'ASSIGNED', issue.id, to, { actorId });
};

/** Status/assignee changes: ASSIGNED to a new assignee, WATCHED_ISSUE_UPDATED to other watchers. */
const issueUpdated: Handler = async (event, { db }) => {
  const p = payloadOf(event);
  const issue = await liveIssue(db, str(p.issueId));
  if (!issue) return;
  const actorId = str(p.actorId);
  const fields = strs(p.fields);
  const assigneeId = str(p.assigneeId);
  const assigned = new Set<string>();
  if (assigneeId && assigneeId !== actorId) {
    const to = await issueRecipients(db, issue.id, [assigneeId]);
    await notify(db, event, 'ASSIGNED', issue.id, to, { actorId });
    to.forEach((r) => assigned.add(r.userId));
  }
  const watchers = (await watcherIds(db, issue.id)).filter(
    (id) => id !== actorId && !assigned.has(id),
  );
  const to = await issueRecipients(db, issue.id, watchers);
  await notify(db, event, 'WATCHED_ISSUE_UPDATED', issue.id, to, { actorId, fields });
};

/** Mentions (already filtered to viewers at write time) and watchers; never the author. */
const issueCommented: Handler = async (event, { db }) => {
  const p = payloadOf(event);
  const issue = await liveIssue(db, str(p.issueId));
  const commentId = str(p.commentId);
  const actorId = str(p.actorId);
  if (!issue || !commentId) return;
  const comment = await db.issueComment.findFirst({
    where: { id: commentId, issueId: issue.id, deletedAt: null },
    select: { id: true },
  });
  if (!comment) return; // deleted or moderated before delivery
  const mentioned = await issueRecipients(
    db,
    issue.id,
    strs(p.mentionedUserIds).filter((id) => id !== actorId),
  );
  await notify(db, event, 'MENTIONED', issue.id, mentioned, { actorId, commentId });
  const skip = new Set([actorId, ...mentioned.map((r) => r.userId)]);
  const to = await issueRecipients(
    db,
    issue.id,
    (await watcherIds(db, issue.id)).filter((id) => !skip.has(id)),
  );
  await notify(db, event, 'WATCHED_ISSUE_UPDATED', issue.id, to, {
    actorId,
    commentId,
    fields: ['comment'],
  });
};

/** FR-NTF-001: the inviter, only while still an ACTIVE Owner/Admin of the workspace. */
const invitationAccepted: Handler = async (event, { db }) => {
  const p = payloadOf(event);
  const invitationId = str(p.invitationId);
  if (!invitationId) return;
  const inv = await db.workspaceInvitation.findUnique({ where: { id: invitationId } });
  if (!inv || inv.state !== 'ACCEPTED' || inv.invitedById === inv.acceptedById) return;
  const inviter = await db.user.findUnique({ where: { id: inv.invitedById } });
  if (inviter?.status !== 'ACTIVE') return;
  const access = await visible(() => resolveWorkspaceAccess(db, inv.invitedById, inv.workspaceId));
  if (!access || access.workspaceRole === 'MEMBER') return;
  await db.notification.createMany({
    data: [
      {
        recipientId: inv.invitedById,
        workspaceId: inv.workspaceId,
        type: 'INVITE_ACCEPTED',
        payload: { actorId: inv.acceptedById },
        dedupeKey: `${event.topic}:${inv.id}:${inv.invitedById}:${event.id}`,
      },
    ],
    skipDuplicates: true,
  });
};

/**
 * Email delivery. The API stored the hash of a throwaway value; here a fresh token is rotated
 * in immediately before sending, so the outbox never held a usable secret. A retry after a
 * failed send rotates again, which only invalidates a link nobody received.
 */
function tokenEmail(kind: 'EMAIL_VERIFY' | 'PASSWORD_RESET'): Handler {
  return async (event, { db, mailer, appBaseUrl }) => {
    const tokenId = str(payloadOf(event).tokenId);
    if (!tokenId) return;
    const record = await db.verificationToken.findUnique({
      where: { id: tokenId },
      include: { user: true },
    });
    if (!record || record.kind !== kind || record.user.status !== 'ACTIVE') return;
    if (kind === 'EMAIL_VERIFY' && record.user.verifiedAt) return;
    const token = newToken();
    const { count } = await db.verificationToken.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { tokenHash: hashToken(token) },
    });
    if (count === 0) return; // superseded, used or expired: nothing worth sending
    await mailer.send(
      kind === 'EMAIL_VERIFY'
        ? {
            to: record.user.email,
            subject: 'Verify your email',
            text: `Confirm your email address: ${appBaseUrl}/verify-email?token=${token}\nThis link expires in 24 hours.`,
          }
        : {
            to: record.user.email,
            subject: 'Reset your password',
            text: `Reset your password: ${appBaseUrl}/reset-password?token=${token}\nThis link expires in 1 hour. If you did not request it, ignore this email.`,
          },
    );
  };
}

const accountExists: Handler = async (event, { db, mailer, appBaseUrl }) => {
  const userId = str(payloadOf(event).userId);
  const user = userId ? await db.user.findUnique({ where: { id: userId } }) : null;
  if (!user) return;
  await mailer.send({
    to: user.email,
    subject: 'You already have an account',
    text: `Someone tried to register with this email. Sign in at ${appBaseUrl}/login or reset your password at ${appBaseUrl}/forgot-password.`,
  });
};

const invitationEmail: Handler = async (event, { db, mailer, appBaseUrl }) => {
  const invitationId = str(payloadOf(event).invitationId);
  if (!invitationId) return;
  const inv = await db.workspaceInvitation.findUnique({
    where: { id: invitationId },
    include: { workspace: true, invitedBy: { select: { name: true } } },
  });
  if (!inv || inv.workspace.status === 'SUSPENDED') return;
  const token = newToken();
  const { count } = await db.workspaceInvitation.updateMany({
    where: { id: inv.id, state: 'PENDING', expiresAt: { gt: new Date() } },
    data: { tokenHash: hashToken(token) },
  });
  if (count === 0) return; // revoked, resent, accepted or expired before delivery
  await mailer.send({
    to: inv.email,
    subject: `${inv.invitedBy.name} invited you to ${inv.workspace.name}`,
    text: `Join ${inv.workspace.name}: ${appBaseUrl}/invitations/accept?token=${token}\nThis invitation expires in 7 days.`,
  });
};

export const HANDLERS: Record<string, Handler> = {
  'issue.assigned': issueAssigned,
  'issue.updated': issueUpdated,
  'issue.commented': issueCommented,
  'invitation.accepted': invitationAccepted,
  [EmailTopic.VERIFY]: tokenEmail('EMAIL_VERIFY'),
  [EmailTopic.PASSWORD_RESET]: tokenEmail('PASSWORD_RESET'),
  [EmailTopic.ACCOUNT_EXISTS]: accountExists,
  [EmailTopic.INVITATION]: invitationEmail,
};
