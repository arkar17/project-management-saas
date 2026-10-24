import {
  burndownDto,
  velocityDto,
  velocityQuery,
  workloadDto,
  workspaceOverviewDto,
} from '@pm/shared';
import { Router, type Request } from 'express';
import { sendDto } from '../../http/respond.js';
import { notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import {
  assertCan,
  assertId,
  resolveProjectAccess,
  resolveWorkspaceAccess,
} from '../../policy/access.js';
import { currentSession } from '../auth/session.middleware.js';
import type { ReportService } from './report.service.js';

/** FR-RPT-001…006. Mounted at /api/v1 behind the tenant guards of each prefix. */
export function reportRouter(db: Db, reports: ReportService) {
  const router = Router();
  const userId = (req: Request) => currentSession(req).userId;
  const projectReports = async (req: Request) => {
    const access = await resolveProjectAccess(db, userId(req), String(req.params.pid));
    assertCan(access, 'readProjectReports');
    return access;
  };

  router.get('/workspaces/:wid/overview', async (req, res) => {
    const access = await resolveWorkspaceAccess(db, userId(req), String(req.params.wid));
    sendDto(res, workspaceOverviewDto, await reports.workspaceOverview(access));
  });
  router.get('/projects/:pid/reports/velocity', async (req, res) => {
    const { limit } = velocityQuery.parse(req.query);
    sendDto(res, velocityDto, await reports.velocity(await projectReports(req), limit));
  });
  router.get('/projects/:pid/reports/workload', async (req, res) => {
    sendDto(res, workloadDto, await reports.workload(await projectReports(req)));
  });
  router.get('/sprints/:sid/burndown', async (req, res) => {
    const sprint = await db.sprint.findUnique({
      where: { id: assertId(String(req.params.sid)) },
      select: { id: true, projectId: true },
    });
    if (!sprint) throw notFound();
    const access = await resolveProjectAccess(db, userId(req), sprint.projectId);
    assertCan(access, 'readProjectReports');
    sendDto(res, burndownDto, await reports.burndown(sprint.id));
  });
  return router;
}
