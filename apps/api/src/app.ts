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
import { createSessionService } from './modules/auth/session.service.js';
import { healthRouter } from './modules/health/health.routes.js';
import { platformAuthRouter } from './modules/platform-admin/platform-auth.routes.js';

const MINUTE = 60 * 1000;

export const DEFAULT_RATE_LIMITS: AuthRateLimits = {
  login: { windowMs: 15 * MINUTE, limit: 10 },
  register: { windowMs: 60 * MINUTE, limit: 10 },
  email: { windowMs: 15 * MINUTE, limit: 5 },
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
  // G2+ tenant modules mount here behind requireSession(sessions, 'APP').

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
