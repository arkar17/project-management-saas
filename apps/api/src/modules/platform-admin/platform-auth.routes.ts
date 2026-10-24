import { loginInput } from '@pm/shared';
import { Router } from 'express';
import { rateLimiter, type RateLimitRule } from '../../http/rate-limit.js';
import { validateBody } from '../../http/validate.js';
import { sessionHandlers } from '../auth/auth.routes.js';
import type { AuthService } from '../auth/auth.service.js';
import { requireSession } from '../auth/session.middleware.js';
import type { SessionService } from '../auth/session.service.js';

/** /platform/auth — PLATFORM session kind only; APP sessions get 401 here (ADR-007). */
export function platformAuthRouter(
  auth: AuthService,
  sessions: SessionService,
  loginLimit: RateLimitRule,
) {
  const router = Router();
  const platform = sessionHandlers(auth, sessions, 'PLATFORM');
  const requirePlatform = requireSession(sessions, 'PLATFORM');

  router.post('/login', rateLimiter(loginLimit), validateBody(loginInput), platform.login);
  router.post('/logout', requirePlatform, platform.logout);
  router.get('/me', requirePlatform, platform.me);
  return router;
}
