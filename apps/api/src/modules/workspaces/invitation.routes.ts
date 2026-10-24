import { invitationDto, invitationPreviewDto, invitationTokenQuery, tokenInput } from '@pm/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { sendDto } from '../../http/respond.js';
import { rateLimiter, type RateLimitRule } from '../../http/rate-limit.js';
import { validateBody } from '../../http/validate.js';
import { currentSession } from '../auth/session.middleware.js';
import type { InvitationService } from './invitation.service.js';

/** /invitations — preview is public (token holder only); the rest need a verified APP session. */
export function invitationRouter(
  invitations: InvitationService,
  requireVerifiedUser: RequestHandler[],
  limits: { invite: RateLimitRule; email: RateLimitRule },
) {
  const router = Router();

  router.get('/preview', rateLimiter(limits.email), async (req, res) => {
    const { token } = invitationTokenQuery.parse(req.query);
    sendDto(res, z.object({ invitation: invitationPreviewDto }), {
      invitation: await invitations.preview(token),
    });
  });

  router.post('/accept', ...requireVerifiedUser, validateBody(tokenInput), async (req, res) => {
    sendDto(
      res,
      z.object({ workspaceId: z.string().uuid() }),
      await invitations.accept(currentSession(req).userId, req.body.token),
    );
  });

  router.post(
    '/:invId/resend',
    ...requireVerifiedUser,
    rateLimiter(limits.invite),
    async (req, res) => {
      const invitation = await invitations.resend(
        currentSession(req).userId,
        String(req.params.invId),
      );
      sendDto(res, z.object({ invitation: invitationDto }), { invitation }, 201);
    },
  );

  router.post('/:invId/revoke', ...requireVerifiedUser, async (req, res) => {
    await invitations.revoke(currentSession(req).userId, String(req.params.invId));
    res.status(204).end();
  });

  return router;
}
