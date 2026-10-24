import { z } from 'zod';
import { ACTORS } from './permissions.js';

export const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** FR-PRJ-001: 2–10 uppercase letters/digits; input is upper-cased first. */
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9]{2,10}$/, 'Key must be 2–10 letters or digits'));

/** Suggests a key from a project name, e.g. "Mobile App Redesign" → "MAR". */
export function suggestProjectKey(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  return key.slice(0, 10);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const nullableDate = isoDate.nullable();

const startBeforeTarget = (v: { startDate?: string | null; targetDate?: string | null }) =>
  !v.startDate || !v.targetDate || v.startDate <= v.targetDate;
const dateOrderIssue = {
  message: 'Start date must be on or before the target date',
  path: ['targetDate'],
};

export const createProjectInput = z
  .object({
    key: projectKeySchema,
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(5000).nullable().optional(),
    status: projectStatusSchema.default('ACTIVE'),
    startDate: nullableDate.optional(),
    targetDate: nullableDate.optional(),
  })
  .refine(startBeforeTarget, dateOrderIssue);
export type CreateProjectInput = z.infer<typeof createProjectInput>;

/** Strict: the key is immutable, so sending it (or any unknown field) is a 422 (TC-PRJ-001-2). */
export const updateProjectInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(5000).nullable(),
    status: projectStatusSchema,
    startDate: nullableDate,
    targetDate: nullableDate,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine(startBeforeTarget, dateOrderIssue);
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

export const projectListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: projectStatusSchema.optional(),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProjectListQuery = z.infer<typeof projectListQuery>;

export const projectRoleSchema = z.enum(['PROJECT_MANAGER', 'MEMBER']);

export const addProjectMemberInput = z.object({
  userId: z.string().uuid(),
  role: projectRoleSchema,
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberInput>;

export const updateProjectMemberInput = z.object({ role: projectRoleSchema });

// ---- Response DTOs (validated before sending) ----

export const projectDto = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: projectStatusSchema,
  startDate: isoDate.nullable(),
  targetDate: isoDate.nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  /** Caller's effective matrix column for this project (UI discoverability only). */
  myAccess: z.enum(ACTORS as [string, ...string[]]),
});
export type ProjectDto = z.infer<typeof projectDto>;

export const projectListDto = z.object({
  projects: z.array(projectDto),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ProjectListDto = z.infer<typeof projectListDto>;

export const projectMemberDto = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  avatarKey: z.string().nullable(),
  role: projectRoleSchema,
  joinedAt: z.string(),
});
export type ProjectMemberDto = z.infer<typeof projectMemberDto>;

export const projectOverviewDto = z.object({
  totalIssues: z.number().int(),
  byStatus: z.record(z.string(), z.number().int()),
  doneIssues: z.number().int(),
  /** Done issues / all issues, 0–100 (0 when the project has no issues). */
  progressPercent: z.number().int().min(0).max(100),
  overdueIssues: z.number().int(),
  /** Not done, due within the next 7 days. */
  upcomingIssues: z.number().int(),
  memberCount: z.number().int(),
  activeSprint: z.object({ id: z.string(), name: z.string(), endAt: z.string() }).nullable(),
});
export type ProjectOverviewDto = z.infer<typeof projectOverviewDto>;

export interface OverviewIssue {
  status: string;
  dueAt: Date | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** FR-PRJ-005 metric definitions; pure so it is unit-tested against fixtures (TC-PRJ-005-1). */
export function computeProjectOverview(issues: readonly OverviewIssue[], now: Date) {
  const byStatus: Record<string, number> = {};
  let done = 0;
  let overdue = 0;
  let upcoming = 0;
  for (const issue of issues) {
    byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    if (issue.status === 'DONE') {
      done++;
      continue;
    }
    if (!issue.dueAt) continue;
    const due = issue.dueAt.getTime();
    if (due < now.getTime()) overdue++;
    else if (due <= now.getTime() + WEEK_MS) upcoming++;
  }
  return {
    totalIssues: issues.length,
    byStatus,
    doneIssues: done,
    progressPercent: issues.length === 0 ? 0 : Math.round((done / issues.length) * 100),
    overdueIssues: overdue,
    upcomingIssues: upcoming,
  };
}
