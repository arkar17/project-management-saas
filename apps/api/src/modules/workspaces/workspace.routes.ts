import {
  createWorkspaceInput,
  inviteInput,
  transferOwnershipInput,
  updateMemberInput,
  updateWorkspaceInput,
} from '@pm/shared';
import { Router, type Request } from 'express';
import { rateLimiter, type RateLimitRule } from '../../http/rate-limit.js';
import { validateBody } from '../../http/validate.js';
import type { Db } from '../../lib/prisma.js';
import { assertWorkspaceCan, assertWritable, resolveWorkspaceAccess } from '../../policy/access.js';
import { sessionMeta } from '../auth/auth.routes.js';
import { currentSession } from '../auth/session.middleware.js';
import {
  SESSION_POLICY,
  sessionCookieOptions,
  type SessionService,
} from '../auth/session.service.js';
import { workspaceProjectsRouter } from '../projects/project.routes.js';
import type { ProjectService } from '../projects/project.service.js';
import type { InvitationService } from './invitation.service.js';
import type { MemberService } from './member.service.js';
import type { WorkspaceService } from './workspace.service.js';

interface Deps {
  db: Db;
  projects: ProjectService;
  workspaces: WorkspaceService;
  members: MemberService;
  invitations: InvitationService;
  sessions: SessionService;
  inviteLimit: RateLimitRule;
}

/** /workspaces — mounted behind requireSession('APP') + requireVerifiedEmail. */
export function workspaceRouter({
  db,
  projects,
  workspaces,
  members,
  invitations,
  sessions,
  inviteLimit,
}: Deps) {
  const router = Router();
  // Workspace is always resolved from the URL + caller membership, never from the body.
  const access = (req: Request) =>
    resolveWorkspaceAccess(db, currentSession(req).userId, String(req.params.wid));

  router.get('/', async (req, res) => {
    res.json({ workspaces: await workspaces.listForUser(currentSession(req).userId) });
  });

  router.post('/', validateBody(createWorkspaceInput), async (req, res) => {
    res
      .status(201)
      .json({ workspace: await workspaces.create(currentSession(req).userId, req.body) });
  });

  router.get('/:wid', async (req, res) => {
    res.json({ workspace: await workspaces.getDetail(await access(req)) });
  });

  router.patch('/:wid', validateBody(updateWorkspaceInput), async (req, res) => {
    const a = await access(req);
    assertWorkspaceCan(a, 'manageWorkspaceSettingsAndInvites');
    assertWritable(a);
    res.json({ workspace: await workspaces.update(a, req.body) });
  });

  router.get('/:wid/members', async (req, res) => {
    const a = await access(req);
    assertWorkspaceCan(a, 'viewMemberList');
    res.json({ members: await members.list(a) });
  });

  router.patch('/:wid/members/:mid', validateBody(updateMemberInput), async (req, res) => {
    const a = await access(req);
    assertWritable(a);
    await members.changeRole(a, String(req.params.mid), req.body.role);
    res.status(204).end();
  });

  router.delete('/:wid/members/:mid', async (req, res) => {
    const a = await access(req);
    assertWritable(a);
    await members.remove(a, String(req.params.mid));
    res.status(204).end();
  });

  router.post(
    '/:wid/transfer-ownership',
    validateBody(transferOwnershipInput),
    async (req, res) => {
      const a = await access(req);
      assertWritable(a);
      await members.transferOwnership(a, req.body.memberId);
      // The caller's privileges changed: rotate their session id (ADR-001).
      const session = currentSession(req);
      await sessions.revoke(session.sessionId);
      const next = await sessions.create(session.userId, 'APP', sessionMeta(req));
      res.cookie(SESSION_POLICY.APP.cookie, next.token, sessionCookieOptions('APP'));
      res.status(204).end();
    },
  );

  router.get('/:wid/invitations', async (req, res) => {
    res.json({ invitations: await invitations.list(await access(req)) });
  });

  router.post(
    '/:wid/invitations',
    rateLimiter(inviteLimit),
    validateBody(inviteInput),
    async (req, res) => {
      res.status(201).json({ invitation: await invitations.create(await access(req), req.body) });
    },
  );

  router.use('/:wid/projects', workspaceProjectsRouter(db, projects));

  return router;
}
