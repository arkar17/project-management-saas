import {
  platformAuditListDto,
  platformAuditQuery,
  platformMetricsDto,
  platformUserListDto,
  platformUserQuery,
  platformWorkspaceDetailDto,
  platformWorkspaceDto,
  platformWorkspaceListDto,
  platformWorkspaceQuery,
  workspaceStatusChangeInput,
} from '@pm/shared';
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { sendDto } from '../../http/respond.js';
import { validateBody } from '../../http/validate.js';
import { forbidden } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import { currentSession } from '../auth/session.middleware.js';
import type { PlatformService } from './platform.service.js';

/**
 * ADR-007 guard, after requireSession('PLATFORM'): the PlatformAdmin record and the user must
 * still be ACTIVE on every request, so revocation takes effect immediately.
 */
export function requirePlatformAdmin(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const admin = await db.platformAdmin.findUnique({
      where: { userId: currentSession(req).userId },
      select: { status: true, user: { select: { status: true } } },
    });
    if (admin?.status !== 'ACTIVE' || admin.user.status !== 'ACTIVE') throw forbidden();
    next();
  };
}

/** /platform (FR-ADM-002…004, FR-NTF-003): metadata, metrics, audit; never tenant content. */
export function platformRouter(platform: PlatformService) {
  const router = Router();
  const adminId = (req: Request) => currentSession(req).userId;
  const workspaceBody = z.object({ workspace: platformWorkspaceDto });

  router.get('/metrics', async (_req, res) => {
    sendDto(res, platformMetricsDto, await platform.metrics());
  });
  router.get('/workspaces', async (req, res) => {
    sendDto(
      res,
      platformWorkspaceListDto,
      await platform.listWorkspaces(platformWorkspaceQuery.parse(req.query)),
    );
  });
  router.get('/workspaces/:wid', async (req, res) => {
    sendDto(res, platformWorkspaceDetailDto, await platform.getWorkspace(String(req.params.wid)));
  });
  router.post(
    '/workspaces/:wid/suspend',
    validateBody(workspaceStatusChangeInput),
    async (req, res) => {
      sendDto(res, workspaceBody, {
        workspace: await platform.suspend(adminId(req), String(req.params.wid), req.body.reason),
      });
    },
  );
  router.post(
    '/workspaces/:wid/reactivate',
    validateBody(workspaceStatusChangeInput),
    async (req, res) => {
      sendDto(res, workspaceBody, {
        workspace: await platform.reactivate(adminId(req), String(req.params.wid), req.body.reason),
      });
    },
  );
  router.get('/users', async (req, res) => {
    sendDto(res, platformUserListDto, await platform.listUsers(platformUserQuery.parse(req.query)));
  });
  router.get('/audit', async (req, res) => {
    sendDto(
      res,
      platformAuditListDto,
      await platform.listAudit(platformAuditQuery.parse(req.query)),
    );
  });
  return router;
}
