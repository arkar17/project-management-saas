import { invitationTokenQuery, tokenInput } from '@pm/shared';
import { Router, type RequestHandler } from 'express';
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
    res.json({ invitation: await invitations.preview(token) });
  });

  router.post('/accept', ...requireVerifiedUser, validateBody(tokenInput), async (req, res) => {
    res.json(await invitations.accept(currentSession(req).userId, req.body.token));
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
      res.status(201).json({ invitation });
    },
  );

  router.post('/:invId/revoke', ...requireVerifiedUser, async (req, res) => {
    await invitations.revoke(currentSession(req).userId, String(req.params.invId));
    res.status(204).end();
  });

  return router;
}
