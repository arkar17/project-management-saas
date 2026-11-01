/**
 * Role × capability policy from PERMISSION_MATRIX_v3.csv (SRS §4, ADR-002/008/020).
 * The API enforces it; the web app uses it only to hide controls the caller cannot use.
 * permissions.test.ts checks this table against the CSV, so the two cannot drift.
 */

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type ProjectRole = 'PROJECT_MANAGER' | 'MEMBER';

/** Matrix columns. Owner/Admin have implicit admin access to every project in their workspace. */
export type Actor =
  'OWNER' | 'ADMIN' | 'PROJECT_MANAGER' | 'PROJECT_MEMBER' | 'WORKSPACE_MEMBER' | 'PLATFORM_ADMIN';

export const ACTORS: readonly Actor[] = [
  'OWNER',
  'ADMIN',
  'PROJECT_MANAGER',
  'PROJECT_MEMBER',
  'WORKSPACE_MEMBER',
  'PLATFORM_ADMIN',
];

/**
 * Y = allowed, N = denied, OWN = only own assigned/reported issue or own comment,
 * NOT_OWNER = allowed except against the Owner, NAMES = names/avatars/roles without emails,
 * SCOPED = limited to projects the caller can see.
 */
export type Grant = 'Y' | 'N' | 'OWN' | 'NOT_OWNER' | 'NAMES' | 'SCOPED';

type Row = readonly [Grant, Grant, Grant, Grant, Grant, Grant];

export const CAPABILITIES = {
  transferOwnership: ['Y', 'N', 'N', 'N', 'N', 'N'],
  manageWorkspaceSettingsAndInvites: ['Y', 'Y', 'N', 'N', 'N', 'N'],
  manageProjectLifecycle: ['Y', 'Y', 'N', 'N', 'N', 'N'],
  manageProjectSettingsAndMembers: ['Y', 'Y', 'Y', 'N', 'N', 'N'],
  createIssue: ['Y', 'Y', 'Y', 'Y', 'N', 'N'],
  editAnyIssue: ['Y', 'Y', 'Y', 'N', 'N', 'N'],
  editOwnIssue: ['Y', 'Y', 'Y', 'OWN', 'N', 'N'],
  manageSprintsAndBacklog: ['Y', 'Y', 'Y', 'N', 'N', 'N'],
  changeOwnIssueStatus: ['Y', 'Y', 'Y', 'OWN', 'N', 'N'],
  commentAndAttach: ['Y', 'Y', 'Y', 'Y', 'N', 'N'],
  readProjectReports: ['Y', 'Y', 'Y', 'Y', 'N', 'N'],
  manageWorkspaceMembers: ['Y', 'NOT_OWNER', 'N', 'N', 'N', 'N'],
  reorderRanking: ['Y', 'Y', 'Y', 'N', 'N', 'N'],
  manageLabels: ['Y', 'Y', 'Y', 'N', 'N', 'N'],
  softDeleteRestoreIssue: ['Y', 'Y', 'Y', 'N', 'N', 'N'],
  moderateComments: ['Y', 'Y', 'Y', 'N', 'N', 'N'],
  watchIssue: ['Y', 'Y', 'Y', 'Y', 'N', 'N'],
  viewMemberList: ['Y', 'Y', 'NAMES', 'NAMES', 'NAMES', 'N'],
  deleteIssuePermanently: ['N', 'N', 'N', 'N', 'N', 'N'],
  removeOrDemoteOwner: ['N', 'N', 'N', 'N', 'N', 'N'],
  grantWorkspacePrivileges: ['Y', 'Y', 'N', 'N', 'N', 'N'],
  editDeleteOwnComment: ['OWN', 'OWN', 'OWN', 'OWN', 'N', 'N'],
  viewWorkspaceOverview: ['Y', 'Y', 'SCOPED', 'SCOPED', 'SCOPED', 'N'],
  readTenantContent: ['Y', 'Y', 'Y', 'Y', 'N', 'N'],
  readPlatformMetadata: ['N', 'N', 'N', 'N', 'N', 'Y'],
  suspendWorkspace: ['N', 'N', 'N', 'N', 'N', 'Y'],
} as const satisfies Record<string, Row>;

export type Capability = keyof typeof CAPABILITIES;

/** Resolves the matrix column for a tenant user from both role layers (no global role). */
export function tenantActor(workspaceRole: WorkspaceRole, projectRole: ProjectRole | null): Actor {
  if (workspaceRole === 'OWNER') return 'OWNER';
  if (workspaceRole === 'ADMIN') return 'ADMIN';
  if (projectRole === 'PROJECT_MANAGER') return 'PROJECT_MANAGER';
  if (projectRole === 'MEMBER') return 'PROJECT_MEMBER';
  return 'WORKSPACE_MEMBER';
}

export function grantFor(actor: Actor, capability: Capability): Grant {
  return CAPABILITIES[capability][ACTORS.indexOf(actor)] as Grant;
}

export interface CapabilityContext {
  /** Caller is assignee/reporter of the issue, or author of the comment. */
  isOwn?: boolean;
  /** Target of a membership change is the workspace Owner. */
  targetIsOwner?: boolean;
}

/** Boolean decision; conditional grants require the matching context flag. */
export function can(actor: Actor, capability: Capability, ctx: CapabilityContext = {}): boolean {
  switch (grantFor(actor, capability)) {
    case 'Y':
    case 'NAMES':
    case 'SCOPED':
      return true;
    case 'OWN':
      return ctx.isOwn === true;
    case 'NOT_OWNER':
      return ctx.targetIsOwner === false;
    case 'N':
      return false;
  }
}

export const ISSUE_FIELDS = [
  'title',
  'description',
  'dueAt',
  'status',
  'projectId',
  'assigneeId',
  'sprintId',
  'storyPoints',
  'priority',
  'type',
  'parentId',
  'labels',
  'rank',
  'deletedAt',
] as const;
export type IssueField = (typeof ISSUE_FIELDS)[number];

const MEMBER_OWN_FIELDS: readonly IssueField[] = ['title', 'description', 'dueAt', 'status'];

/**
 * Field allow-list for issue edits (matrix "Field (issue edit)" section, ADR-008).
 * projectId is immutable for every role (ADR-006).
 */
export function editableIssueFields(actor: Actor, isOwnIssue: boolean): readonly IssueField[] {
  if (actor === 'OWNER' || actor === 'ADMIN' || actor === 'PROJECT_MANAGER') {
    return ISSUE_FIELDS.filter((f) => f !== 'projectId');
  }
  if (actor === 'PROJECT_MEMBER' && isOwnIssue) return MEMBER_OWN_FIELDS;
  return [];
}
