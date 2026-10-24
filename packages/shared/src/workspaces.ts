import { z } from 'zod';
import { emailSchema } from './auth.js';
import type { WorkspaceRole } from './permissions.js';

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

export interface WorkspaceSummaryDto {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: WorkspaceStatus;
  myRole: WorkspaceRole;
}

export interface WorkspaceDetailDto extends WorkspaceSummaryDto {
  memberCount: number;
  /** Projects the caller can see (all for Owner/Admin, own memberships otherwise). */
  projectCount: number;
  createdAt: string;
}

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  avatarKey: string | null;
  role: WorkspaceRole;
  joinedAt: string;
  /** Present for Owner/Admin callers only (FR-TEN-008). */
  email?: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  state: InvitationState;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

export interface InvitationPreviewDto {
  workspaceName: string;
  invitedBy: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  expiresAt: string;
}
