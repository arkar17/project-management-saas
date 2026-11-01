import { z } from 'zod';
import { emailSchema } from './auth.js';

/** FR-TEN-001: slugs are lower-case, hyphen-separated and unique after normalisation. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** IANA zone names only (FR-TEN-007); offsets such as "+02:00" are rejected. */
export function isValidTimezone(tz: string): boolean {
  if (tz !== 'UTC' && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimezone, 'Must be a valid IANA timezone');

export const slugSchema = z
  .string()
  .trim()
  .transform(slugify)
  .pipe(
    z
      .string()
      .min(3, 'Slug must be at least 3 characters')
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  );

export const createWorkspaceInput = z.object({
  name: z.string().trim().min(2).max(80),
  /** Defaults to slugify(name). */
  slug: slugSchema.optional(),
  /** Defaults to the creator's timezone. */
  timezone: timezoneSchema.optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export const updateWorkspaceInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    timezone: timezoneSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInput>;

/** Invitations grant ADMIN or MEMBER only; OWNER is reachable solely by transfer (ADR-013). */
export const invitationRoleSchema = z.enum(['ADMIN', 'MEMBER']);

export const inviteInput = z.object({ email: emailSchema, role: invitationRoleSchema });
export type InviteInput = z.infer<typeof inviteInput>;

export const updateMemberInput = z.object({ role: invitationRoleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberInput>;

export const transferOwnershipInput = z.object({ memberId: z.string().uuid() });
export type TransferOwnershipInput = z.infer<typeof transferOwnershipInput>;

export const invitationTokenQuery = z.object({ token: z.string().min(1).max(200) });

export type WorkspaceStatus = 'ACTIVE' | 'SUSPENDED';
export type InvitationState = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

const workspaceRole = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
const invitationRole = z.enum(['ADMIN', 'MEMBER']);

// Response contracts (validated by sendDto, GAP-01).
export const workspaceSummaryDto = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  myRole: workspaceRole,
});
export type WorkspaceSummaryDto = z.infer<typeof workspaceSummaryDto>;

export const workspaceDetailDto = workspaceSummaryDto.extend({
  memberCount: z.number().int(),
  /** Projects the caller can see (all for Owner/Admin, own memberships otherwise). */
  projectCount: z.number().int(),
  createdAt: z.string(),
});
export type WorkspaceDetailDto = z.infer<typeof workspaceDetailDto>;

export const memberDto = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  avatarKey: z.string().nullable(),
  role: workspaceRole,
  joinedAt: z.string(),
  /** Present for Owner/Admin callers only (FR-TEN-008). */
  email: z.string().optional(),
});
export type MemberDto = z.infer<typeof memberDto>;

export const invitationDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: invitationRole,
  state: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']),
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedBy: z.string(),
});
export type InvitationDto = z.infer<typeof invitationDto>;

export const invitationPreviewDto = z.object({
  workspaceName: z.string(),
  invitedBy: z.string(),
  email: z.string(),
  role: invitationRole,
  expiresAt: z.string(),
});
export type InvitationPreviewDto = z.infer<typeof invitationPreviewDto>;
