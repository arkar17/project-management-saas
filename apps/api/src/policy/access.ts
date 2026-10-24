import {
  ErrorCode,
  can,
  editableIssueFields,
  tenantActor,
  type Actor,
  type Capability,
  type CapabilityContext,
  type IssueField,
  type WorkspaceRole,
} from '@pm/shared';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import type { Db } from '../lib/prisma.js';

/**
 * Tenant policy service (ADR-002). Every tenant route resolves access from the caller's
 * memberships and the URL resource's ancestry (Issue → Project → Workspace); a workspaceId in
 * the request body is never trusted. Anything the caller cannot see is a 404.
 */

export interface WorkspaceAccess {
  userId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  suspended: boolean;
}

export interface ProjectAccess extends WorkspaceAccess {
  projectId: string;
  actor: Actor;
  archived: boolean;
}

export interface IssueAccess extends ProjectAccess {
  issueId: string;
  isOwnIssue: boolean;
}

export async function resolveWorkspaceAccess(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, status: true, workspace: { select: { status: true } } },
  });
  if (!member || member.status !== 'ACTIVE') throw notFound();
  return {
    userId,
    workspaceId,
    workspaceRole: member.role,
    suspended: member.workspace.status === 'SUSPENDED',
  };
}

export async function resolveProjectAccess(
  db: Db,
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true, archivedAt: true },
  });
  if (!project) throw notFound();
  const workspace = await resolveWorkspaceAccess(db, userId, project.workspaceId);

  let projectRole = null;
  if (workspace.workspaceRole === 'MEMBER') {
    const pm = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true, status: true },
    });
    projectRole = pm?.status === 'ACTIVE' ? pm.role : null;
  }
  const actor = tenantActor(workspace.workspaceRole, projectRole);
  // Workspace members without a project row cannot read project content (matrix, FR-PRJ-002).
  if (!can(actor, 'readTenantContent')) throw notFound();
  return { ...workspace, projectId, actor, archived: project.archivedAt !== null };
}

export async function resolveIssueAccess(
  db: Db,
  userId: string,
  issueId: string,
): Promise<IssueAccess> {
  const issue = await db.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true, reporterId: true, assigneeId: true, deletedAt: true },
  });
  if (!issue) throw notFound();
  const project = await resolveProjectAccess(db, userId, issue.projectId);
  // Soft-deleted issues are visible only to those who may restore them (FR-ISS-007).
  if (issue.deletedAt && !can(project.actor, 'softDeleteRestoreIssue')) throw notFound();
  return {
    ...project,
    issueId,
    isOwnIssue: issue.reporterId === userId || issue.assigneeId === userId,
  };
}

export function assertCan(
  access: { actor: Actor },
  capability: Capability,
  ctx: CapabilityContext = {},
): void {
  if (!can(access.actor, capability, ctx)) throw forbidden();
}

/** Workspace-level capability check for routes without a project in scope. */
export function assertWorkspaceCan(
  access: WorkspaceAccess,
  capability: Capability,
  ctx: CapabilityContext = {},
): void {
  assertCan({ actor: tenantActor(access.workspaceRole, null) }, capability, ctx);
}

/** Mutations are refused in suspended workspaces (403) and archived projects (409). */
export function assertWritable(access: WorkspaceAccess & { archived?: boolean }): void {
  if (access.suspended) throw forbidden(ErrorCode.WORKSPACE_SUSPENDED, 'Workspace is suspended');
  if (access.archived) throw conflict(ErrorCode.PROJECT_ARCHIVED, 'Project is archived');
}

/** Rejects a patch touching any field outside the caller's allow-list (403 FIELD_FORBIDDEN). */
export function assertIssueFieldsAllowed(access: IssueAccess, fields: readonly IssueField[]): void {
  const allowed = editableIssueFields(access.actor, access.isOwnIssue);
  const denied = fields.filter((f) => !allowed.includes(f));
  if (denied.length > 0) {
    throw new AppError(403, ErrorCode.FIELD_FORBIDDEN, 'Field change not permitted', {
      fields: denied,
    });
  }
}
