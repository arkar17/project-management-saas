import * as c from '@pm/shared';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * OpenAPI 3.1 contract (GAP-05), generated from the same Zod schemas the routes validate with.
 * `npm run openapi -w @pm/api` writes docs/openapi.json; test/unit/openapi.test.ts fails when a
 * route is missing here or the committed file is stale.
 */

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
type Auth = 'public' | 'app' | 'platform';

interface Op {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  auth: Auth;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  /** Success schema; omitted for 204 / plain responses. */
  res?: ZodTypeAny;
  status?: number;
}

const obj = (shape: z.ZodRawShape) => z.object(shape);
const issueBody = obj({ issue: c.issueDto });
const ok = obj({ status: z.string() });

const r = (
  method: Method,
  path: string,
  tag: string,
  summary: string,
  auth: Auth,
  extra: Partial<Op> = {},
): Op => ({ method, path, tag, summary, auth, ...extra });

export const OPERATIONS: Op[] = [
  // Health
  r('get', '/health', 'Health', 'Liveness', 'public', { res: ok }),
  r('get', '/health/ready', 'Health', 'Readiness (database reachable)', 'public', { res: ok }),

  // Auth (APP)
  r('get', '/auth/csrf', 'Auth', 'Issue a CSRF token', 'public', {
    res: obj({ csrfToken: z.string() }),
  }),
  r('post', '/auth/register', 'Auth', 'Register (account-neutral 202)', 'public', {
    body: c.registerInput,
    res: ok,
    status: 202,
  }),
  r('post', '/auth/verify-email', 'Auth', 'Verify email with token', 'public', {
    body: c.tokenInput,
    status: 204,
  }),
  r(
    'post',
    '/auth/resend-verification',
    'Auth',
    'Resend verification (account-neutral)',
    'public',
    { body: c.emailInput, res: ok, status: 202 },
  ),
  r('post', '/auth/login', 'Auth', 'Sign in (APP session)', 'public', {
    body: c.loginInput,
    res: obj({ user: c.authUserDto, csrfToken: z.string() }),
  }),
  r('post', '/auth/logout', 'Auth', 'Sign out', 'app', { status: 204 }),
  r('get', '/auth/me', 'Auth', 'Current user', 'app', { res: obj({ user: c.authUserDto }) }),
  r('post', '/auth/forgot-password', 'Auth', 'Request a reset link (account-neutral)', 'public', {
    body: c.emailInput,
    res: ok,
    status: 202,
  }),
  r('post', '/auth/reset-password', 'Auth', 'Reset password with token', 'public', {
    body: c.resetPasswordInput,
    status: 204,
  }),

  // Users (FR-AUTH-004)
  r('get', '/users/me', 'Users', 'Own profile', 'app', { res: obj({ user: c.authUserDto }) }),
  r('patch', '/users/me/preferences', 'Users', 'Update name and timezone', 'app', {
    body: c.updatePreferencesInput,
    res: obj({ user: c.authUserDto }),
  }),
  r('post', '/users/me/password', 'Users', 'Change password (revokes other sessions)', 'app', {
    body: c.changePasswordInput,
    status: 204,
  }),
  r(
    'post',
    '/users/me/deactivate',
    'Users',
    'Deactivate own account (blocked while Owner)',
    'app',
    { body: c.deactivateAccountInput, status: 204 },
  ),

  // Workspaces
  r('get', '/workspaces', 'Workspaces', 'My workspaces', 'app', {
    res: obj({ workspaces: z.array(c.workspaceSummaryDto) }),
  }),
  r('post', '/workspaces', 'Workspaces', 'Create workspace', 'app', {
    body: c.createWorkspaceInput,
    res: obj({ workspace: c.workspaceSummaryDto }),
    status: 201,
  }),
  r('get', '/workspaces/{wid}', 'Workspaces', 'Workspace detail', 'app', {
    res: obj({ workspace: c.workspaceDetailDto }),
  }),
  r('patch', '/workspaces/{wid}', 'Workspaces', 'Update workspace (Owner/Admin)', 'app', {
    body: c.updateWorkspaceInput,
    res: obj({ workspace: c.workspaceSummaryDto }),
  }),
  r('get', '/workspaces/{wid}/members', 'Workspaces', 'Member list', 'app', {
    res: obj({ members: z.array(c.memberDto) }),
  }),
  r('patch', '/workspaces/{wid}/members/{mid}', 'Workspaces', 'Change member role', 'app', {
    body: c.updateMemberInput,
    status: 204,
  }),
  r('delete', '/workspaces/{wid}/members/{mid}', 'Workspaces', 'Remove member (cascade)', 'app', {
    status: 204,
  }),
  r('post', '/workspaces/{wid}/transfer-ownership', 'Workspaces', 'Transfer ownership', 'app', {
    body: c.transferOwnershipInput,
    status: 204,
  }),
  r(
    'get',
    '/workspaces/{wid}/invitations',
    'Invitations',
    'List invitations (Owner/Admin)',
    'app',
    { res: obj({ invitations: z.array(c.invitationDto) }) },
  ),
  r('post', '/workspaces/{wid}/invitations', 'Invitations', 'Invite by email', 'app', {
    body: c.inviteInput,
    res: obj({ invitation: c.invitationDto }),
    status: 201,
  }),
  r('get', '/invitations/preview', 'Invitations', 'Preview an invitation by token', 'public', {
    query: c.invitationTokenQuery,
    res: obj({ invitation: c.invitationPreviewDto }),
  }),
  r('post', '/invitations/accept', 'Invitations', 'Accept an invitation', 'app', {
    body: c.tokenInput,
    res: obj({ workspaceId: z.string().uuid() }),
  }),
  r('post', '/invitations/{invId}/resend', 'Invitations', 'Resend (revokes the old token)', 'app', {
    res: obj({ invitation: c.invitationDto }),
    status: 201,
  }),
  r('post', '/invitations/{invId}/revoke', 'Invitations', 'Revoke an invitation', 'app', {
    status: 204,
  }),
  r('get', '/workspaces/{wid}/overview', 'Reports', 'Workspace dashboard (FR-RPT-001)', 'app', {
    res: c.workspaceOverviewDto,
  }),

  // Projects
  r('get', '/workspaces/{wid}/projects', 'Projects', 'List projects', 'app', {
    query: c.projectListQuery,
    res: c.projectListDto,
  }),
  r('post', '/workspaces/{wid}/projects', 'Projects', 'Create project', 'app', {
    body: c.createProjectInput,
    res: obj({ project: c.projectDto }),
    status: 201,
  }),
  r('get', '/projects/{pid}', 'Projects', 'Project detail', 'app', {
    res: obj({ project: c.projectDto }),
  }),
  r('patch', '/projects/{pid}', 'Projects', 'Update project', 'app', {
    body: c.updateProjectInput,
    res: obj({ project: c.projectDto }),
  }),
  r('post', '/projects/{pid}/archive', 'Projects', 'Archive project', 'app', {
    res: obj({ project: c.projectDto }),
  }),
  r('post', '/projects/{pid}/unarchive', 'Projects', 'Unarchive project', 'app', {
    res: obj({ project: c.projectDto }),
  }),
  r(
    'get',
    '/projects/{pid}/reports/overview',
    'Reports',
    'Project overview (FR-PRJ-005, FR-RPT-002)',
    'app',
    { res: obj({ overview: c.projectOverviewDto }) },
  ),
  r('get', '/projects/{pid}/reports/velocity', 'Reports', 'Velocity (FR-RPT-004)', 'app', {
    query: c.velocityQuery,
    res: c.velocityDto,
  }),
  r('get', '/projects/{pid}/reports/workload', 'Reports', 'Workload (FR-RPT-005)', 'app', {
    res: c.workloadDto,
  }),
  r('get', '/projects/{pid}/members', 'Projects', 'Project members', 'app', {
    res: obj({ members: z.array(c.projectMemberDto) }),
  }),
  r('post', '/projects/{pid}/members', 'Projects', 'Add project member', 'app', {
    body: c.addProjectMemberInput,
    res: obj({ members: z.array(c.projectMemberDto) }),
    status: 201,
  }),
  r('patch', '/projects/{pid}/members/{pmid}', 'Projects', 'Change project role', 'app', {
    body: c.updateProjectMemberInput,
    status: 204,
  }),
  r('delete', '/projects/{pid}/members/{pmid}', 'Projects', 'Remove project member', 'app', {
    status: 204,
  }),

  // Issues
  r('get', '/projects/{pid}/issues', 'Issues', 'List/search issues', 'app', {
    query: c.issueListQuery,
    res: c.issueListDto,
  }),
  r('post', '/projects/{pid}/issues', 'Issues', 'Create issue', 'app', {
    body: c.createIssueInput,
    res: issueBody,
    status: 201,
  }),
  r('get', '/projects/{pid}/labels', 'Issues', 'Project labels', 'app', {
    res: obj({ labels: z.array(c.labelDto) }),
  }),
  r('post', '/projects/{pid}/labels', 'Issues', 'Create label', 'app', {
    body: c.labelInput,
    res: obj({ label: c.labelDto }),
    status: 201,
  }),
  r('patch', '/labels/{lid}', 'Issues', 'Update label', 'app', {
    body: c.updateLabelInput,
    res: obj({ label: c.labelDto }),
  }),
  r('delete', '/labels/{lid}', 'Issues', 'Delete label', 'app', { status: 204 }),
  r('get', '/issues/{iid}', 'Issues', 'Issue detail', 'app', { res: issueBody }),
  r('patch', '/issues/{iid}', 'Issues', 'Update issue (field allow-list)', 'app', {
    body: c.updateIssueInput,
    res: issueBody,
  }),
  r('delete', '/issues/{iid}', 'Issues', 'Soft-delete issue', 'app', { status: 204 }),
  r('post', '/issues/{iid}/restore', 'Issues', 'Restore issue', 'app', { res: issueBody }),
  r('put', '/issues/{iid}/labels', 'Issues', 'Set issue labels', 'app', {
    body: c.setIssueLabelsInput,
    res: issueBody,
  }),
  r('get', '/issues/{iid}/children', 'Issues', 'Child issues', 'app', {
    res: obj({ issues: z.array(c.issueDto) }),
  }),
  r('get', '/issues/{iid}/activity', 'Issues', 'Activity history', 'app', {
    res: obj({ activity: z.array(c.activityDto) }),
  }),
  r('get', '/issues/{iid}/watchers', 'Issues', 'Watchers', 'app', { res: c.watchersDto }),
  r('post', '/issues/{iid}/watch', 'Issues', 'Watch issue', 'app', { res: c.watchersDto }),
  r('delete', '/issues/{iid}/watch', 'Issues', 'Unwatch issue', 'app', { res: c.watchersDto }),
  r('get', '/issues/{iid}/comments', 'Comments', 'List comments', 'app', {
    res: obj({ comments: z.array(c.commentDto) }),
  }),
  r('post', '/issues/{iid}/comments', 'Comments', 'Add comment', 'app', {
    body: c.commentInput,
    res: obj({ comment: c.commentDto }),
    status: 201,
  }),
  r('patch', '/comments/{cid}', 'Comments', 'Edit own comment (15 min)', 'app', {
    body: c.commentInput,
    res: obj({ comment: c.commentDto }),
  }),
  r('delete', '/comments/{cid}', 'Comments', 'Delete own comment', 'app', { status: 204 }),
  r('post', '/comments/{cid}/moderate', 'Comments', 'Moderate comment (reason required)', 'app', {
    body: c.moderateCommentInput,
    status: 204,
  }),
  r('get', '/issues/{iid}/attachments', 'Attachments', 'List attachments', 'app', {
    res: obj({ attachments: z.array(c.attachmentDto) }),
  }),
  r(
    'post',
    '/issues/{iid}/attachments',
    'Attachments',
    'Start upload (5-minute signed PUT)',
    'app',
    { body: c.initiateAttachmentInput, res: obj({ upload: c.attachmentUploadDto }), status: 201 },
  ),
  r(
    'post',
    '/issues/{iid}/attachments/confirm',
    'Attachments',
    'Confirm upload (size/type/signature checks)',
    'app',
    { body: c.confirmAttachmentInput, res: obj({ attachment: c.attachmentDto }), status: 201 },
  ),
  r('get', '/attachments/{aid}/download', 'Attachments', 'Signed download URL (5 minutes)', 'app', {
    res: obj({ download: c.attachmentDownloadDto }),
  }),

  // Board and sprints
  r('get', '/projects/{pid}/board', 'Board', 'Kanban board', 'app', {
    query: c.boardQuery,
    res: c.boardDto,
  }),
  r('get', '/projects/{pid}/backlog', 'Board', 'Backlog', 'app', {
    query: c.boardQuery,
    res: obj({ issues: z.array(c.issueDto) }),
  }),
  r('patch', '/issues/{iid}/status', 'Board', 'Move issue to a status', 'app', {
    body: c.moveIssueInput,
    res: issueBody,
  }),
  r('patch', '/issues/{iid}/rank', 'Board', 'Reorder issue (PM+)', 'app', {
    body: c.rankIssueInput,
    res: issueBody,
  }),
  r('get', '/projects/{pid}/sprints', 'Sprints', 'List sprints', 'app', {
    res: obj({ sprints: z.array(c.sprintDto) }),
  }),
  r('post', '/projects/{pid}/sprints', 'Sprints', 'Create sprint', 'app', {
    body: c.createSprintInput,
    res: c.sprintDetailDto,
    status: 201,
  }),
  r('get', '/sprints/{sid}', 'Sprints', 'Sprint detail', 'app', { res: c.sprintDetailDto }),
  r('get', '/sprints/{sid}/report', 'Sprints', 'Sprint report', 'app', { res: c.sprintReportDto }),
  r('get', '/sprints/{sid}/burndown', 'Reports', 'Sprint burndown (FR-RPT-003)', 'app', {
    res: c.burndownDto,
  }),
  r('patch', '/sprints/{sid}', 'Sprints', 'Update sprint', 'app', {
    body: c.updateSprintInput,
    res: c.sprintDetailDto,
  }),
  r('put', '/sprints/{sid}/issues', 'Sprints', 'Change sprint scope', 'app', {
    body: c.sprintIssuesInput,
    res: c.sprintDetailDto,
  }),
  r('post', '/sprints/{sid}/start', 'Sprints', 'Start sprint', 'app', { res: c.sprintDetailDto }),
  r('post', '/sprints/{sid}/complete', 'Sprints', 'Complete sprint', 'app', {
    body: c.completeSprintInput,
    res: c.sprintDetailDto,
  }),
  r('post', '/sprints/{sid}/cancel', 'Sprints', 'Cancel planned sprint', 'app', {
    res: c.sprintDetailDto,
  }),

  // Notifications
  r('get', '/notifications', 'Notifications', 'List notifications', 'app', {
    query: c.notificationListQuery,
    res: c.notificationListDto,
  }),
  r('get', '/notifications/unread-count', 'Notifications', 'Unread badge count', 'app', {
    res: c.unreadCountDto,
  }),
  r('patch', '/notifications/{nid}/read', 'Notifications', 'Mark read', 'app', { status: 204 }),
  r('patch', '/notifications/{nid}/unread', 'Notifications', 'Mark unread', 'app', { status: 204 }),
  r('post', '/notifications/read-all', 'Notifications', 'Mark all read', 'app', { status: 204 }),

  // Platform (PLATFORM session + ACTIVE PlatformAdmin)
  r('post', '/platform/auth/login', 'Platform', 'Platform sign-in (PLATFORM session)', 'public', {
    body: c.loginInput,
    res: obj({ user: c.authUserDto, csrfToken: z.string() }),
  }),
  r('post', '/platform/auth/logout', 'Platform', 'Platform sign-out', 'platform', { status: 204 }),
  r('get', '/platform/auth/me', 'Platform', 'Current platform admin', 'platform', {
    res: obj({ user: c.authUserDto }),
  }),
  r('get', '/platform/metrics', 'Platform', 'Platform metrics and job health', 'platform', {
    res: c.platformMetricsDto,
  }),
  r('get', '/platform/workspaces', 'Platform', 'Workspace metadata list', 'platform', {
    query: c.platformWorkspaceQuery,
    res: c.platformWorkspaceListDto,
  }),
  r('get', '/platform/workspaces/{wid}', 'Platform', 'Workspace metadata detail', 'platform', {
    res: c.platformWorkspaceDetailDto,
  }),
  r(
    'post',
    '/platform/workspaces/{wid}/suspend',
    'Platform',
    'Suspend workspace (reason required)',
    'platform',
    { body: c.workspaceStatusChangeInput, res: obj({ workspace: c.platformWorkspaceDto }) },
  ),
  r(
    'post',
    '/platform/workspaces/{wid}/reactivate',
    'Platform',
    'Reactivate workspace (reason required)',
    'platform',
    { body: c.workspaceStatusChangeInput, res: obj({ workspace: c.platformWorkspaceDto }) },
  ),
  r(
    'get',
    '/platform/users',
    'Platform',
    'User metadata list, read-only (approved deviation GAP-13)',
    'platform',
    { query: c.platformUserQuery, res: c.platformUserListDto },
  ),
  r('get', '/platform/audit', 'Platform', 'Platform audit log', 'platform', {
    query: c.platformAuditQuery,
    res: c.platformAuditListDto,
  }),
];

function jsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const { $schema: _s, ...rest } = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    effectStrategy: 'input',
  }) as Record<string, unknown>;
  return rest;
}

function queryParameters(schema: ZodTypeAny | undefined) {
  if (!schema) return [];
  const shape = schema instanceof z.ZodObject ? (schema.shape as z.ZodRawShape) : {};
  return Object.entries(shape).map(([name, field]) => ({
    name,
    in: 'query',
    required: !field.isOptional(),
    schema: jsonSchema(field),
  }));
}

const errorRef = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
});

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const status = String(op.status ?? 200);
    const mutating = op.method !== 'get';
    const responses: Record<string, unknown> = {
      [status]: op.res
        ? {
            description: 'Success',
            content: { 'application/json': { schema: jsonSchema(op.res) } },
          }
        : { description: 'Success, no body' },
      ...(op.body || op.query ? { '422': errorRef('Validation error') } : {}),
      ...(op.auth !== 'public' ? { '401': errorRef('No valid session of the required kind') } : {}),
      ...(mutating ? { '403': errorRef('Forbidden, CSRF failure or suspended workspace') } : {}),
      ...(pathParams.length > 0 ? { '404': errorRef('Not found or not visible') } : {}),
    };
    paths[op.path] ??= {};
    paths[op.path]![op.method] = {
      tags: [op.tag],
      summary: op.summary,
      operationId: `${op.method}${op.path.replace(/\{(\w+)\}/g, 'By_$1').replace(/[^a-zA-Z0-9]+(.)?/g, (_m, ch: string | undefined) => (ch ?? '').toUpperCase())}`,
      security:
        op.auth === 'app'
          ? [{ appSession: [], ...(mutating ? { csrf: [] } : {}) }]
          : op.auth === 'platform'
            ? [{ platformSession: [], ...(mutating ? { csrf: [] } : {}) }]
            : mutating
              ? [{ csrf: [] }]
              : [],
      parameters: [...pathParams, ...queryParameters(op.query)],
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema(op.body) } },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Project Management SaaS API',
      version: '1.0.0',
      description:
        'Multi-tenant project management API (Baseline 3.0). Errors follow ADR-015; tenant resources outside the caller’s scope return 404. Mutations require the double-submit CSRF header and an allowed Origin.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        appSession: { type: 'apiKey', in: 'cookie', name: 'pm_sid' },
        platformSession: { type: 'apiKey', in: 'cookie', name: 'pm_psid' },
        csrf: { type: 'apiKey', in: 'header', name: c.CSRF_HEADER },
      },
      schemas: {
        ApiError: {
          type: 'object',
          required: ['code', 'message', 'requestId'],
          properties: {
            code: { type: 'string', enum: Object.values(c.ErrorCode) },
            message: { type: 'string' },
            details: {},
            requestId: { type: 'string' },
          },
        },
      },
    },
    paths,
  };
}
