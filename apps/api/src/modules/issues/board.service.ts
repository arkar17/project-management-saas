import {
  ErrorCode,
  MAX_RANK_LENGTH,
  rankBetween,
  type BoardDto,
  type BoardQuery,
  type IssueDto,
  type IssueStatus,
  type MoveIssueInput,
  type RankIssueInput,
} from '@pm/shared';
import { ISSUE_STATUSES } from '@pm/shared';
import type { Prisma } from '@prisma/client';
import { conflict } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import {
  assertIssueFieldsAllowed,
  assertWritable,
  type IssueAccess,
  type ProjectAccess,
} from '../../policy/access.js';
import { toSprintDto } from '../sprints/sprint.service.js';
import {
  endOfColumn,
  issueInclude,
  lockProject,
  rebalanceRanks,
  toIssueDto,
} from './issue.service.js';

type Tx = Prisma.TransactionClient;
type Scope = 'board' | 'backlog';

const staleBoard = () =>
  conflict(
    ErrorCode.VERSION_CONFLICT,
    'The board changed while you were editing. Reload and try again.',
  );

/** Issues that share an ordering: a status column (board) or the backlog list. */
function scopeWhere(projectId: string, scope: Scope, status: IssueStatus): Prisma.IssueWhereInput {
  return scope === 'board'
    ? { projectId, status, deletedAt: null }
    : { projectId, sprintId: null, status: { not: 'DONE' }, deletedAt: null };
}

/**
 * Rank for placing `issueId` right after `afterId` (null = top) within a scope. The anchor
 * is authoritative: the key goes between the anchor and its *current* successor, so
 * concurrent inserts after the same anchor stay distinct and ordered.
 */
async function rankAfterAnchor(
  tx: Tx,
  projectId: string,
  scope: Scope,
  status: IssueStatus,
  issueId: string,
  afterId: string | null,
): Promise<string> {
  const where = { ...scopeWhere(projectId, scope, status), id: { not: issueId } };
  let prev: string | null = null;
  if (afterId) {
    const anchor = await tx.issue.findFirst({
      where: { ...where, id: afterId },
      select: { rank: true },
    });
    if (!anchor) throw staleBoard();
    prev = anchor.rank;
  }
  const next = await tx.issue.findFirst({
    where: { ...where, ...(prev ? { rank: { gt: prev } } : {}) },
    orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    select: { rank: true },
  });
  // Equal neighbour ranks (legacy data) leave no room: rebalance and retry once.
  if (next && prev !== null && next.rank <= prev) {
    await rebalanceRanks(tx, projectId);
    return rankAfterAnchor(tx, projectId, scope, status, issueId, afterId);
  }
  const key = rankBetween(prev, next?.rank ?? null);
  if (key.length <= MAX_RANK_LENGTH) return key;
  await rebalanceRanks(tx, projectId);
  return rankAfterAnchor(tx, projectId, scope, status, issueId, afterId);
}

async function bumpVersion(
  tx: Tx,
  access: IssueAccess,
  version: number,
  data: Prisma.IssueUpdateManyMutationInput,
) {
  const { count } = await tx.issue.updateMany({
    where: { id: access.issueId, version, deletedAt: null },
    data: { ...data, version: { increment: 1 } },
  });
  if (count === 0) {
    throw conflict(
      ErrorCode.VERSION_CONFLICT,
      'This issue was changed by someone else. Reload and try again.',
    );
  }
}

export function createBoardService(db: Db) {
  return {
    /** FR-BRD-001/004: five columns ordered by rank, optionally scoped to one sprint. */
    async board(access: ProjectAccess, q: BoardQuery): Promise<BoardDto> {
      let sprint = null;
      if (q.sprint) {
        sprint = await db.sprint.findFirst({
          where: {
            projectId: access.projectId,
            ...(q.sprint === 'active' ? { status: 'ACTIVE' } : { id: q.sprint }),
          },
          include: { issues: { where: { deletedAt: null }, select: { storyPoints: true } } },
        });
      }
      const where: Prisma.IssueWhereInput = {
        projectId: access.projectId,
        deletedAt: null,
        // "Active sprint" with no active sprint shows an empty board, never the whole project.
        ...(q.sprint ? { sprintId: sprint?.id ?? '00000000-0000-0000-0000-000000000000' } : {}),
        ...(q.type ? { type: { in: q.type } } : {}),
        ...(q.priority ? { priority: { in: q.priority } } : {}),
        ...(q.labelId ? { labels: { some: { labelId: q.labelId } } } : {}),
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
      const issues = await db.issue.findMany({
        where,
        include: issueInclude,
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        take: 500,
      });
      const dtos = issues.map(toIssueDto);
      return {
        sprint: sprint ? toSprintDto(sprint) : null,
        columns: ISSUE_STATUSES.map((status) => ({
          status,
          issues: dtos.filter((i) => i.status === status),
        })),
      };
    },

    /** ADR-016: backlog = not in any sprint and not DONE, in rank order. */
    async backlog(access: ProjectAccess, q: BoardQuery): Promise<IssueDto[]> {
      const rows = await db.issue.findMany({
        where: {
          ...scopeWhere(access.projectId, 'backlog', 'BACKLOG'),
          ...(q.type ? { type: { in: q.type } } : {}),
          ...(q.priority ? { priority: { in: q.priority } } : {}),
          ...(q.labelId ? { labels: { some: { labelId: q.labelId } } } : {}),
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
        },
        include: issueInclude,
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        take: 500,
      });
      return rows.map(toIssueDto);
    },

    /**
     * FR-BRD-002: status change via the board. Members (own issues only) always append to
     * the end of the target column; any position they send is ignored (ADR-008).
     */
    async move(access: IssueAccess, input: MoveIssueInput): Promise<IssueDto> {
      assertWritable(access);
      assertIssueFieldsAllowed(access, ['status']);
      const mayPosition = access.actor !== 'PROJECT_MEMBER';
      return db.$transaction(async (tx) => {
        await lockProject(tx, access.projectId);
        const current = await tx.issue.findUniqueOrThrow({ where: { id: access.issueId } });
        if (current.version !== input.version) throw staleBoard();
        const rank =
          mayPosition && input.afterId !== undefined
            ? await rankAfterAnchor(
                tx,
                access.projectId,
                'board',
                input.status,
                current.id,
                input.afterId,
              )
            : current.status === input.status
              ? current.rank
              : await endOfColumn(tx, access.projectId, current.id);
        await bumpVersion(tx, access, input.version, { status: input.status, rank });
        if (current.status !== input.status) {
          await tx.issueActivity.create({
            data: {
              issueId: current.id,
              actorId: access.userId,
              field: 'status',
              oldValue: current.status,
              newValue: input.status,
            },
          });
          await tx.outboxEvent.create({
            data: {
              topic: 'issue.updated',
              aggregateId: current.id,
              payload: { issueId: current.id, actorId: access.userId, fields: ['status'] },
            },
          });
        }
        return toIssueDto(
          await tx.issue.findUniqueOrThrow({ where: { id: current.id }, include: issueInclude }),
        );
      });
    },

    /** FR-BRD-003: pure reordering (board column or backlog) is PM/Admin/Owner only. */
    async rank(access: IssueAccess, input: RankIssueInput): Promise<IssueDto> {
      assertWritable(access);
      assertIssueFieldsAllowed(access, ['rank']);
      return db.$transaction(async (tx) => {
        await lockProject(tx, access.projectId);
        const current = await tx.issue.findUniqueOrThrow({ where: { id: access.issueId } });
        if (current.version !== input.version) throw staleBoard();
        const rank = await rankAfterAnchor(
          tx,
          access.projectId,
          input.scope,
          current.status,
          current.id,
          input.afterId,
        );
        await bumpVersion(tx, access, input.version, { rank });
        return toIssueDto(
          await tx.issue.findUniqueOrThrow({ where: { id: current.id }, include: issueInclude }),
        );
      });
    },
  };
}

export type BoardService = ReturnType<typeof createBoardService>;
