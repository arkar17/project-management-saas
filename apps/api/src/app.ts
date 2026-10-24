import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import { csrfProtection } from './http/csrf.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { genRequestId } from './http/request-id.js';
import type { Mailer } from './lib/mailer.js';
import type { Db } from './lib/prisma.js';
import { authRouter, type AuthRateLimits } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { requireSession, requireVerifiedEmail } from './modules/auth/session.middleware.js';
import { createSessionService } from './modules/auth/session.service.js';
import { healthRouter } from './modules/health/health.routes.js';
import { platformAuthRouter } from './modules/platform-admin/platform-auth.routes.js';
import { invitationRouter } from './modules/workspaces/invitation.routes.js';
import { createInvitationService } from './modules/workspaces/invitation.service.js';
import { createMemberService } from './modules/workspaces/member.service.js';
import { workspaceRouter } from './modules/workspaces/workspace.routes.js';
import { createWorkspaceService } from './modules/workspaces/workspace.service.js';

const MINUTE = 60 * 1000;

export const DEFAULT_RATE_LIMITS: AuthRateLimits = {
  login: { windowMs: 15 * MINUTE, limit: 10 },
  register: { windowMs: 60 * MINUTE, limit: 10 },
  email: { windowMs: 15 * MINUTE, limit: 5 },
  invite: { windowMs: 60 * MINUTE, limit: 30 },
};

export interface AppDeps {
  env: Pick<Env, 'WEB_ORIGINS' | 'APP_BASE_URL' | 'TRUST_PROXY'>;
  db: Db;
  mailer: Mailer;
  logger: Logger;
  rateLimits?: AuthRateLimits;
}

export function createApp({ env, db, mailer, logger, rateLimits = DEFAULT_RATE_LIMITS }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(pinoHttp({ logger, genReqId: genRequestId }));
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const sessions = createSessionService(db);
  const auth = createAuthService({ db, sessions, mailer, logger, appBaseUrl: env.APP_BASE_URL });

  const api = express.Router();
  api.use('/health', healthRouter(db));
  api.use(csrfProtection(env.WEB_ORIGINS));
  api.use('/auth', authRouter(auth, sessions, rateLimits));
  api.use('/platform/auth', platformAuthRouter(auth, sessions, rateLimits.login));

  // Tenant routes: APP session + verified email (FR-AUTH-001, TC-AUTH-001-3).
  const requireVerifiedUser = [requireSession(sessions, 'APP'), requireVerifiedEmail(db)];
  const invitations = createInvitationService(db, mailer, env.APP_BASE_URL);
  api.use('/invitations', invitationRouter(invitations, requireVerifiedUser, rateLimits));
  api.use(
    '/workspaces',
    ...requireVerifiedUser,
    workspaceRouter({
      db,
      workspaces: createWorkspaceService(db),
      members: createMemberService(db),
      invitations,
      sessions,
      inviteLimit: rateLimits.invite,
    }),
  );

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
