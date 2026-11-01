import { z } from 'zod';

export const ISSUE_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK'] as const;
export const ISSUE_STATUSES = ['BACKLOG', 'TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
export const ISSUE_PRIORITIES = ['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST'] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

/** ADR-006 parent → allowed child types. Depth ≤ 2 follows from the matrix. */
export const ALLOWED_CHILDREN: Record<IssueType, readonly IssueType[]> = {
  EPIC: ['STORY', 'TASK', 'BUG'],
  STORY: ['SUBTASK'],
  TASK: ['SUBTASK'],
  BUG: [],
  SUBTASK: [],
};

/** Returns an error message, or null when the parent/child pairing is valid (FR-ISS-004). */
export function hierarchyError(type: IssueType, parentType: IssueType | null): string | null {
  if (parentType === null)
    return type === 'SUBTASK' ? 'A subtask needs a parent story or task' : null;
  if (type === 'EPIC') return 'An epic cannot have a parent';
  return ALLOWED_CHILDREN[parentType].includes(type)
    ? null
    : `A ${parentType.toLowerCase()} cannot contain a ${type.toLowerCase()}`;
}

/** An issue's new type must still accept every existing child type. */
export function childrenError(type: IssueType, childTypes: readonly IssueType[]): string | null {
  const bad = childTypes.find((c) => !ALLOWED_CHILDREN[type].includes(c));
  return bad
    ? `A ${type.toLowerCase()} cannot contain its existing ${bad.toLowerCase()} children`
    : null;
}

/**
 * FR-ISS-002 server-side sanitising. Descriptions are stored and rendered as plain Markdown
 * text, so raw HTML is stripped and script-capable link targets are neutralised.
 */
export function sanitizeMarkdown(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/\]\(\s*(?:javascript|vbscript|data):\S*\)/gi, '](#)')
    .replaceAll(String.fromCharCode(0), '')
    .trim();
}

/** @mentions use the member's email, e.g. "@ada@example.com" (FR-ISS-005). */
export function parseMentions(body: string): string[] {
  const found = body.match(/(?<![\w.])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g) ?? [];
  return [...new Set(found.map((m) => m.slice(1).toLowerCase()))];
}

const markdown = z.string().max(20_000).transform(sanitizeMarkdown);
const dueAt = z.string().datetime({ offset: true }).nullable();
const storyPoints = z.number().int().min(0).max(100).nullable();
const id = z.string().uuid();

export const createIssueInput = z.object({
  type: z.enum(ISSUE_TYPES),
  title: z.string().trim().min(1).max(200),
  description: markdown.nullable().optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  assigneeId: id.nullable().optional(),
  parentId: id.nullable().optional(),
  storyPoints: storyPoints.optional(),
  dueAt: dueAt.optional(),
  labelIds: z.array(id).max(20).optional(),
});
export type CreateIssueInput = z.infer<typeof createIssueInput>;

/**
 * Strict so that projectId/key (immutable for every role, ADR-006) are rejected with 422.
 * `version` is required for optimistic concurrency (FR-ISS-008).
 */
export const updateIssueInput = z
  .object({
    version: z.number().int().min(1),
    type: z.enum(ISSUE_TYPES).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: markdown.nullable().optional(),
    status: z.enum(ISSUE_STATUSES).optional(),
    priority: z.enum(ISSUE_PRIORITIES).optional(),
    assigneeId: id.nullable().optional(),
    parentId: id.nullable().optional(),
    storyPoints: storyPoints.optional(),
    dueAt: dueAt.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, 'Nothing to update');
export type UpdateIssueInput = z.infer<typeof updateIssueInput>;

export const setIssueLabelsInput = z.object({ labelIds: z.array(id).max(20) });

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();

export const issueListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  type: csv(ISSUE_TYPES),
  status: csv(ISSUE_STATUSES),
  priority: csv(ISSUE_PRIORITIES),
  labelId: id.optional(),
  sprintId: z.union([id, z.literal('none')]).optional(),
  /** A user id, "me" or "none". */
  assignee: z.union([id, z.literal('me'), z.literal('none')]).optional(),
  deleted: z.enum(['true', 'false']).default('false'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type IssueListQuery = z.infer<typeof issueListQuery>;

export const labelInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #4f46e5'),
});
export const updateLabelInput = labelInput.partial().refine((v) => Object.keys(v).length > 0);

export const commentInput = z.object({
  body: z.string().trim().min(1).max(10_000).transform(sanitizeMarkdown),
});
export const moderateCommentInput = z.object({ reason: z.string().trim().min(1).max(500) });

/** Authors may edit for 15 minutes after posting (FR-ISS-005). */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

// ---- Response DTOs ----

const userRef = z.object({ id: z.string().uuid(), name: z.string() });

export const labelDto = z.object({ id: z.string().uuid(), name: z.string(), color: z.string() });
export type LabelDto = z.infer<typeof labelDto>;

export const issueDto = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  key: z.string(),
  number: z.number().int(),
  type: z.enum(ISSUE_TYPES),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.enum(ISSUE_PRIORITIES),
  reporter: userRef,
  assignee: userRef.nullable(),
  parent: z
    .object({
      id: z.string().uuid(),
      key: z.string(),
      title: z.string(),
      type: z.enum(ISSUE_TYPES),
    })
    .nullable(),
  sprintId: z.string().uuid().nullable(),
  storyPoints: z.number().int().nullable(),
  rank: z.string(),
  version: z.number().int(),
  dueAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  labels: z.array(labelDto),
  childCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IssueDto = z.infer<typeof issueDto>;

export const issueListDto = z.object({
  issues: z.array(issueDto),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type IssueListDto = z.infer<typeof issueListDto>;

export const commentDto = z.object({
  id: z.string().uuid(),
  author: userRef,
  /** Always null once removed: deleted bodies never leave the API (ADR-014). */
  body: z.string().nullable(),
  removed: z.boolean(),
  moderated: z.boolean(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
});
export type CommentDto = z.infer<typeof commentDto>;

export const activityDto = z.object({
  id: z.string().uuid(),
  actor: userRef,
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  createdAt: z.string(),
});
export type ActivityDto = z.infer<typeof activityDto>;

export const watchersDto = z.object({ watchers: z.array(userRef), watching: z.boolean() });
export type WatchersDto = z.infer<typeof watchersDto>;
