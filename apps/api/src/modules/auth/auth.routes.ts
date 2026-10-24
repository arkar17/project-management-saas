import { emailInput, loginInput, registerInput, resetPasswordInput, tokenInput } from '@pm/shared';
import { authUserDto } from '@pm/shared';
import type { SessionKind } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { issueCsrfToken } from '../../http/csrf.js';
import { rateLimiter, type RateLimitRule } from '../../http/rate-limit.js';
import { validateBody } from '../../http/validate.js';
import { toAuthUser, type AuthService } from './auth.service.js';
import { currentSession, requireSession } from './session.middleware.js';
import { SESSION_POLICY, sessionCookieOptions, type SessionService } from './session.service.js';

export interface AuthRateLimits {
  login: RateLimitRule;
  register: RateLimitRule;
  email: RateLimitRule;
}

const accepted = (res: Response) => res.status(202).json({ status: 'accepted' });

export function sessionMeta(req: Request) {
  return {
    ipHash: req.ip ? createHash('sha256').update(req.ip).digest('hex') : undefined,
    userAgent: req.get('user-agent'),
  };
}

/** Shared by APP (/auth) and PLATFORM (/platform/auth) login/logout handlers. */
export function sessionHandlers(auth: AuthService, sessions: SessionService, kind: SessionKind) {
  const { cookie } = SESSION_POLICY[kind];
  return {
    async login(req: Request, res: Response) {
      const previous: unknown = req.cookies?.[cookie];
      const { user, session } = await auth.login(req.body, kind, {
        ...sessionMeta(req),
        previousToken: typeof previous === 'string' ? previous : undefined,
      });
      res.cookie(cookie, session.token, sessionCookieOptions(kind));
      const csrfToken = issueCsrfToken(res);
      res.json({ user: authUserDto.parse(toAuthUser(user)), csrfToken });
    },
    async logout(req: Request, res: Response) {
      await sessions.revoke(currentSession(req).sessionId);
      const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions(kind);
      res.clearCookie(cookie, clearOptions);
      res.status(204).end();
    },
    async me(req: Request, res: Response) {
      const user = await auth.getUser(currentSession(req).userId);
      res.json({ user: authUserDto.parse(toAuthUser(user)) });
    },
  };
}

export function authRouter(auth: AuthService, sessions: SessionService, limits: AuthRateLimits) {
  const router = Router();
  const app = sessionHandlers(auth, sessions, 'APP');
  const requireApp = requireSession(sessions, 'APP');
  const emailLimiter = rateLimiter(limits.email);

  router.get('/csrf', (_req, res) => {
    res.json({ csrfToken: issueCsrfToken(res) });
  });

  router.post(
    '/register',
    rateLimiter(limits.register),
    validateBody(registerInput),
    async (req, res) => {
      await auth.register(req.body);
      accepted(res);
    },
  );

  router.post('/verify-email', emailLimiter, validateBody(tokenInput), async (req, res) => {
    await auth.verifyEmail(req.body.token);
    res.status(204).end();
  });

  router.post('/resend-verification', emailLimiter, validateBody(emailInput), async (req, res) => {
    await auth.resendVerification(req.body.email);
    accepted(res);
  });

  router.post('/login', rateLimiter(limits.login), validateBody(loginInput), app.login);
  router.post('/logout', requireApp, app.logout);
  router.get('/me', requireApp, app.me);

  router.post('/forgot-password', emailLimiter, validateBody(emailInput), async (req, res) => {
    await auth.forgotPassword(req.body.email);
    accepted(res);
  });

  router.post(
    '/reset-password',
    emailLimiter,
    validateBody(resetPasswordInput),
    async (req, res) => {
      await auth.resetPassword(req.body);
      res.status(204).end();
    },
  );

  return router;
}
