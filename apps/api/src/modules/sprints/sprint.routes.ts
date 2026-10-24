import {
  SPRINT_STATUSES,
  boardDto,
  boardQuery,
  completeSprintInput,
  createSprintInput,
  issueDto,
  moveIssueInput,
  rankIssueInput,
  sprintDetailDto,
  sprintDto,
  sprintIssuesInput,
  sprintReportDto,
  updateSprintInput,
} from '@pm/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendDto } from '../../http/respond.js';
import { validateBody } from '../../http/validate.js';
import type { Db } from '../../lib/prisma.js';
import { resolveIssueAccess, resolveProjectAccess } from '../../policy/access.js';
import { currentSession } from '../auth/session.middleware.js';
import type { BoardService } from '../issues/board.service.js';
import type { SprintService } from './sprint.service.js';

const statusFilter = z
  .string()
  .transform((v) => v.split(',').filter(Boolean))
  .pipe(z.array(z.enum(SPRINT_STATUSES)))
  .optional();

/** Board, backlog and sprint routes; each resolves Project → Workspace ancestry (ADR-002). */
export function sprintRouter(db: Db, board: BoardService, sprints: SprintService) {
  const router = Router();
  const userId = (req: Request) => currentSession(req).userId;
  const project = (req: Request) => resolveProjectAccess(db, userId(req), String(req.params.pid));
  const issue = (req: Request) => resolveIssueAccess(db, userId(req), String(req.params.iid));
  const sid = (req: Request) => String(req.params.sid);

  router.get('/projects/:pid/board', async (req, res) => {
    sendDto(res, boardDto, await board.board(await project(req), boardQuery.parse(req.query)));
  });
  router.get('/projects/:pid/backlog', async (req, res) => {
    const issues = await board.backlog(await project(req), boardQuery.parse(req.query));
    sendDto(res, z.object({ issues: z.array(issueDto) }), { issues });
  });
  router.patch('/issues/:iid/status', validateBody(moveIssueInput), async (req, res) => {
    sendDto(res, z.object({ issue: issueDto }), {
      issue: await board.move(await issue(req), req.body),
    });
  });
  router.patch('/issues/:iid/rank', validateBody(rankIssueInput), async (req, res) => {
    sendDto(res, z.object({ issue: issueDto }), {
      issue: await board.rank(await issue(req), req.body),
    });
  });

  router.get('/projects/:pid/sprints', async (req, res) => {
    const status = statusFilter.parse(req.query.status);
    sendDto(res, z.object({ sprints: z.array(sprintDto) }), {
      sprints: await sprints.list(await project(req), status),
    });
  });
  router.post('/projects/:pid/sprints', validateBody(createSprintInput), async (req, res) => {
    sendDto(res, sprintDetailDto, await sprints.create(await project(req), req.body), 201);
  });
  router.get('/sprints/:sid', async (req, res) => {
    const { sprint } = await sprints.resolve(userId(req), sid(req));
    sendDto(res, sprintDetailDto, await sprints.detail(db, sprint.id));
  });
  router.get('/sprints/:sid/report', async (req, res) => {
    const { sprint } = await sprints.resolve(userId(req), sid(req));
    sendDto(res, sprintReportDto, await sprints.report(sprint.id));
  });
  router.patch('/sprints/:sid', validateBody(updateSprintInput), async (req, res) => {
    sendDto(res, sprintDetailDto, await sprints.update(userId(req), sid(req), req.body));
  });
  router.put('/sprints/:sid/issues', validateBody(sprintIssuesInput), async (req, res) => {
    sendDto(res, sprintDetailDto, await sprints.changeIssues(userId(req), sid(req), req.body));
  });
  router.post('/sprints/:sid/start', async (req, res) => {
    sendDto(res, sprintDetailDto, await sprints.start(userId(req), sid(req)));
  });
  router.post('/sprints/:sid/complete', async (req, res) => {
    // Missing or malformed destination is 422 DESTINATION_REQUIRED (TC-SPR-004-1).
    const parsed = completeSprintInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(422).json({
        code: 'DESTINATION_REQUIRED',
        message: 'Choose where unfinished issues go',
        requestId: String(req.id),
      });
      return;
    }
    sendDto(res, sprintDetailDto, await sprints.complete(userId(req), sid(req), parsed.data));
  });
  router.post('/sprints/:sid/cancel', async (req, res) => {
    sendDto(res, sprintDetailDto, await sprints.cancel(userId(req), sid(req)));
  });
  return router;
}
