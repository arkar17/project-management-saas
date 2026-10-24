import type { SessionKind } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import { unauthenticated } from '../../lib/errors.js';
import {
  SESSION_POLICY,
  sessionCookieOptions,
  type ResolvedSession,
  type SessionService,
} from './session.service.js';

declare module 'express-serve-static-core' {
  interface Request {
    session?: ResolvedSession;
  }
}

/** Rejects requests without a valid session of exactly this kind with 401 (TC-AUTH-002-3). */
export function requireSession(sessions: SessionService, kind: SessionKind): RequestHandler {
  const { cookie } = SESSION_POLICY[kind];
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[cookie];
    const session = typeof token === 'string' ? await sessions.resolve(token, kind) : null;
    if (!session) throw unauthenticated();
    if (session.extended) res.cookie(cookie, token, sessionCookieOptions(kind));
    req.session = session;
    next();
  };
}

export function currentSession(req: Request): ResolvedSession {
  if (!req.session) throw unauthenticated();
  return req.session;
}
