import {
  addProjectMemberInput,
  createProjectInput,
  projectDto,
  projectListDto,
  projectListQuery,
  projectMemberDto,
  projectOverviewDto,
  updateProjectInput,
  updateProjectMemberInput,
} from '@pm/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendDto } from '../../http/respond.js';
import { validateBody } from '../../http/validate.js';
import type { Db } from '../../lib/prisma.js';
import {
  assertCan,
  assertWorkspaceCan,
  assertWritable,
  resolveProjectAccess,
  resolveWorkspaceAccess,
} from '../../policy/access.js';
import { currentSession } from '../auth/session.middleware.js';
import type { ProjectMemberService } from './project-member.service.js';
import type { ProjectService } from './project.service.js';

const memberList = z.object({ members: z.array(projectMemberDto) });
const projectBody = z.object({ project: projectDto });

/** /workspaces/:wid/projects (create/list) — mounted inside the workspace router. */
export function workspaceProjectsRouter(db: Db, projects: ProjectService) {
  const router = Router({ mergeParams: true });
  const access = (req: Request) =>
    resolveWorkspaceAccess(db, currentSession(req).userId, String(req.params.wid));

  router.get('/', async (req, res) => {
    const a = await access(req);
    sendDto(res, projectListDto, await projects.list(a, projectListQuery.parse(req.query)));
  });

  router.post('/', validateBody(createProjectInput), async (req, res) => {
    const a = await access(req);
    assertWorkspaceCan(a, 'manageProjectLifecycle');
    assertWritable(a);
    sendDto(res, projectBody, { project: await projects.create(a, req.body) }, 201);
  });

  return router;
}

/** /projects/:pid — ancestry Project → Workspace resolved per request (ADR-002). */
export function projectRouter(db: Db, projects: ProjectService, members: ProjectMemberService) {
  const router = Router();
  const access = (req: Request) =>
    resolveProjectAccess(db, currentSession(req).userId, String(req.params.pid));

  router.get('/:pid', async (req, res) => {
    sendDto(res, projectBody, { project: await projects.get(await access(req)) });
  });

  router.patch('/:pid', validateBody(updateProjectInput), async (req, res) => {
    const a = await access(req);
    assertCan(a, 'manageProjectSettingsAndMembers');
    assertWritable(a);
    sendDto(res, projectBody, { project: await projects.update(a, req.body) });
  });

  router.post('/:pid/archive', async (req, res) => {
    const a = await access(req);
    assertCan(a, 'manageProjectLifecycle');
    assertWritable({ ...a, archived: false }); // suspension still blocks; archived → 409 below
    sendDto(res, projectBody, { project: await projects.setArchived(a, true) });
  });

  router.post('/:pid/unarchive', async (req, res) => {
    const a = await access(req);
    assertCan(a, 'manageProjectLifecycle');
    assertWritable({ ...a, archived: false });
    sendDto(res, projectBody, { project: await projects.setArchived(a, false) });
  });

  router.get('/:pid/reports/overview', async (req, res) => {
    const a = await access(req);
    assertCan(a, 'readProjectReports');
    sendDto(res, z.object({ overview: projectOverviewDto }), {
      overview: await projects.overview(a),
    });
  });

  router.get('/:pid/members', async (req, res) => {
    sendDto(res, memberList, { members: await members.list(await access(req)) });
  });

  router.post('/:pid/members', validateBody(addProjectMemberInput), async (req, res) => {
    const a = await access(req);
    assertCan(a, 'manageProjectSettingsAndMembers');
    assertWritable(a);
    await members.add(a, req.body);
    sendDto(res, memberList, { members: await members.list(a) }, 201);
  });

  router.patch('/:pid/members/:pmid', validateBody(updateProjectMemberInput), async (req, res) => {
    const a = await access(req);
    assertCan(a, 'manageProjectSettingsAndMembers');
    assertWritable(a);
    await members.changeRole(a, String(req.params.pmid), req.body.role);
    res.status(204).end();
  });

  router.delete('/:pid/members/:pmid', async (req, res) => {
    const a = await access(req);
    assertCan(a, 'manageProjectSettingsAndMembers');
    assertWritable(a);
    await members.remove(a, String(req.params.pmid));
    res.status(204).end();
  });

  return router;
}
