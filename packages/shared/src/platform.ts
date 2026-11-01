import { z } from 'zod';

/** FR-ADM-001…004 contracts. Platform views expose tenant *metadata* only (FR-ADM-003). */

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const search = z.string().trim().max(100).optional();

export const platformWorkspaceQuery = z.object({
  search,
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  ...page,
});
export type PlatformWorkspaceQuery = z.infer<typeof platformWorkspaceQuery>;

export const platformUserQuery = z.object({
  search,
  status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
  ...page,
});
export type PlatformUserQuery = z.infer<typeof platformUserQuery>;

export const platformAuditQuery = z.object({
  action: z.string().trim().max(100).optional(),
  workspaceId: z.string().uuid().optional(),
  actorType: z.enum(['USER', 'PLATFORM_ADMIN', 'SYSTEM']).optional(),
  ...page,
});
export type PlatformAuditQuery = z.infer<typeof platformAuditQuery>;

/** FR-ADM-002: a reason is mandatory for both suspension and reactivation. */
export const workspaceStatusChangeInput = z.object({
  reason: z.string().trim().min(3).max(500),
});

const pageMeta = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };

export const platformWorkspaceDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  suspendedAt: z.string().nullable(),
  timezone: z.string(),
  createdAt: z.string(),
  activeMembers: z.number().int(),
  projects: z.number().int(),
  owner: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
export type PlatformWorkspaceDto = z.infer<typeof platformWorkspaceDto>;

export const platformWorkspaceListDto = z.object({
  workspaces: z.array(platformWorkspaceDto),
  ...pageMeta,
});

export const platformAuditEntryDto = z.object({
  id: z.string().uuid(),
  action: z.string(),
  actorType: z.enum(['USER', 'PLATFORM_ADMIN', 'SYSTEM']),
  actor: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  workspace: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  targetType: z.string(),
  targetId: z.string(),
  /** Only platform actions carry metadata here (e.g. a suspension reason); tenant rows do not. */
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type PlatformAuditEntryDto = z.infer<typeof platformAuditEntryDto>;

export const platformAuditListDto = z.object({
  entries: z.array(platformAuditEntryDto),
  ...pageMeta,
});

export const platformWorkspaceDetailDto = z.object({
  workspace: platformWorkspaceDto.extend({
    archivedProjects: z.number().int(),
    pendingInvitations: z.number().int(),
  }),
  /** Suspension/reactivation history for this workspace. */
  statusHistory: z.array(platformAuditEntryDto),
});

export const platformUserDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(['ACTIVE', 'DEACTIVATED']),
  emailVerified: z.boolean(),
  platformAdmin: z.boolean(),
  activeWorkspaces: z.number().int(),
  createdAt: z.string(),
});
export type PlatformUserDto = z.infer<typeof platformUserDto>;

export const platformUserListDto = z.object({ users: z.array(platformUserDto), ...pageMeta });

export const platformMetricsDto = z.object({
  workspaces: z.object({
    total: z.number().int(),
    active: z.number().int(),
    suspended: z.number().int(),
  }),
  users: z.object({ total: z.number().int(), active: z.number().int() }),
  /** Distinct users with at least one ACTIVE membership in an ACTIVE workspace. */
  activeMembers: z.number().int(),
  jobs: z.object({
    pending: z.number().int(),
    dead: z.number().int(),
    retrying: z.number().int(),
    oldestPendingAt: z.string().nullable(),
  }),
});
export type PlatformMetricsDto = z.infer<typeof platformMetricsDto>;
