import {
  authUserDto,
  changePasswordInput,
  deactivateAccountInput,
  updatePreferencesInput,
} from '@pm/shared';
import { Router } from 'express';
import { z } from 'zod';
import { sendDto } from '../../http/respond.js';
import { validateBody } from '../../http/validate.js';
import { toAuthUser } from '../auth/auth.service.js';
import { currentSession } from '../auth/session.middleware.js';
import { SESSION_POLICY, sessionCookieOptions } from '../auth/session.service.js';
import type { UserService } from './user.service.js';
import type { Db } from '../../lib/prisma.js';

const userBody = z.object({ user: authUserDto });

/** /users/me (FR-AUTH-004). Mounted behind requireSession('APP'). */
export function userRouter(db: Db, users: UserService) {
  const router = Router();

  router.get('/me', async (req, res) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: currentSession(req).userId } });
    sendDto(res, userBody, { user: toAuthUser(user) });
  });
  router.patch('/me/preferences', validateBody(updatePreferencesInput), async (req, res) => {
    const user = await users.updatePreferences(currentSession(req).userId, req.body);
    sendDto(res, userBody, { user: toAuthUser(user) });
  });
  router.post('/me/password', validateBody(changePasswordInput), async (req, res) => {
    const session = currentSession(req);
    await users.changePassword(session.userId, session.sessionId, req.body);
    res.status(204).end();
  });
  router.post('/me/deactivate', validateBody(deactivateAccountInput), async (req, res) => {
    await users.deactivate(currentSession(req).userId, req.body.password);
    const { maxAge: _maxAge, ...clear } = sessionCookieOptions('APP');
    res.clearCookie(SESSION_POLICY.APP.cookie, clear);
    res.status(204).end();
  });
  return router;
}
