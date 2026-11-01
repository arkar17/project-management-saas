import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, issueDto } from './issues.js';

export const SPRINT_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type SprintStatus = (typeof SPRINT_STATUSES)[number];

const isoDateTime = z.string().datetime({ offset: true });
const id = z.string().uuid();

export const createSprintInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    goal: z.string().trim().max(500).nullable().optional(),
    startAt: isoDateTime,
    endAt: isoDateTime,
    issueIds: z.array(id).max(200).optional(),
  })
  .refine((v) => new Date(v.startAt) < new Date(v.endAt), {
    message: 'The end must be after the start',
    path: ['endAt'],
  });
export type CreateSprintInput = z.infer<typeof createSprintInput>;

/** Which fields each state accepts is enforced by the service (FR-SPR-006). */
export const updateSprintInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    goal: z.string().trim().max(500).nullable(),
    startAt: isoDateTime,
    endAt: isoDateTime,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateSprintInput = z.infer<typeof updateSprintInput>;

export const sprintIssuesInput = z
  .object({ add: z.array(id).max(200).default([]), remove: z.array(id).max(200).default([]) })
  .refine((v) => v.add.length + v.remove.length > 0, 'Nothing to change');
export type SprintIssuesInput = z.infer<typeof sprintIssuesInput>;

/** FR-SPR-004: the destination of unfinished issues must be chosen explicitly. */
export const completeSprintInput = z.object({
  destination: z.union([
    z.object({ type: z.literal('backlog') }),
    z.object({ type: z.literal('sprint'), sprintId: id }),
  ]),
});
export type CompleteSprintInput = z.infer<typeof completeSprintInput>;

/** Board/backlog move: status for everyone allowed; position only for PM+ (ADR-008). */
export const moveIssueInput = z.object({
  version: z.number().int().min(1),
  status: z.enum(ISSUE_STATUSES),
  /** Place after this issue in the target column; null = top; omitted = end. */
  afterId: id.nullable().optional(),
});
export type MoveIssueInput = z.infer<typeof moveIssueInput>;

export const rankIssueInput = z.object({
  version: z.number().int().min(1),
  scope: z.enum(['board', 'backlog']),
  afterId: id.nullable(),
});
export type RankIssueInput = z.infer<typeof rankIssueInput>;

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();

export const boardQuery = z.object({
  /** "active" (current sprint), a sprint id, or omitted for the whole project. */
  sprint: z.union([z.literal('active'), id]).optional(),
  assignee: z.union([id, z.literal('me'), z.literal('none')]).optional(),
  priority: csv(ISSUE_PRIORITIES),
  type: csv(ISSUE_TYPES),
  labelId: id.optional(),
  search: z.string().trim().max(100).optional(),
});
export type BoardQuery = z.infer<typeof boardQuery>;

export const sprintDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  goal: z.string().nullable(),
  status: z.enum(SPRINT_STATUSES),
  startAt: z.string(),
  endAt: z.string(),
  startedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  issueCount: z.number().int(),
  points: z.number().int(),
});
export type SprintDto = z.infer<typeof sprintDto>;

export const sprintDetailDto = z.object({ sprint: sprintDto, issues: z.array(issueDto) });
export type SprintDetailDto = z.infer<typeof sprintDetailDto>;

/** FR-SPR-005 basic report, derived only from frozen SprintIssueHistory values (ADR-003). */
export const sprintReportDto = z.object({
  sprint: sprintDto,
  committedIssues: z.number().int(),
  committedPoints: z.number().int(),
  /** Committed issues without an estimate; they count as 0 points (ADR-003, FR-RPT-003). */
  unestimatedCommitted: z.number().int(),
  addedAfterStart: z.number().int(),
  removedDuringSprint: z.number().int(),
  completedIssues: z.number().int(),
  completedPoints: z.number().int(),
  carriedOver: z.number().int(),
});
export type SprintReportDto = z.infer<typeof sprintReportDto>;

export const boardDto = z.object({
  sprint: sprintDto.nullable(),
  columns: z.array(z.object({ status: z.enum(ISSUE_STATUSES), issues: z.array(issueDto) })),
});
export type BoardDto = z.infer<typeof boardDto>;
