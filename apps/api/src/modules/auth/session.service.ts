import type { SessionKind } from '@prisma/client';
import type { CookieOptions } from 'express';
import type { Db } from '../../lib/prisma.js';
import { hashToken, newToken } from '../../lib/tokens.js';

const HOUR = 60 * 60 * 1000;

/** ADR-001: APP = 7-day sliding expiry, PLATFORM = 8-hour absolute expiry, separate cookies. */
export const SESSION_POLICY = {
  APP: { cookie: 'pm_sid', ttlMs: 7 * 24 * HOUR, sliding: true },
  PLATFORM: { cookie: 'pm_psid', ttlMs: 8 * HOUR, sliding: false },
} as const satisfies Record<SessionKind, { cookie: string; ttlMs: number; sliding: boolean }>;

// Avoids a DB write per request: the sliding window is only extended once an hour.
const SLIDE_THRESHOLD_MS = HOUR;

export function sessionCookieOptions(kind: SessionKind): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_POLICY[kind].ttlMs,
  };
}

export interface SessionMeta {
  ipHash?: string | undefined;
  userAgent?: string | undefined;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  kind: SessionKind;
  /** True when the sliding expiry moved, so the cookie must be re-issued. */
  extended: boolean;
}

export function createSessionService(db: Db) {
  return {
    async create(userId: string, kind: SessionKind, meta: SessionMeta = {}) {
      const token = newToken();
      const expiresAt = new Date(Date.now() + SESSION_POLICY[kind].ttlMs);
      const session = await db.session.create({
        data: {
          userId,
          kind,
          tokenHash: hashToken(token),
          expiresAt,
          ipHash: meta.ipHash ?? null,
          userAgent: meta.userAgent?.slice(0, 256) ?? null,
        },
      });
      return { token, sessionId: session.id, expiresAt };
    },

    /** A token only resolves for its own kind, so APP and PLATFORM sessions never cross over. */
    async resolve(token: string, kind: SessionKind): Promise<ResolvedSession | null> {
      const session = await db.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: {
          user: { select: { status: true, platformAdmin: { select: { status: true } } } },
        },
      });
      const now = Date.now();
      if (
        !session ||
        session.kind !== kind ||
        session.revokedAt ||
        session.expiresAt.getTime() <= now ||
        session.user.status !== 'ACTIVE'
      ) {
        return null;
      }
      if (kind === 'PLATFORM' && session.user.platformAdmin?.status !== 'ACTIVE') return null;

      const policy = SESSION_POLICY[kind];
      const extended =
        policy.sliding && session.expiresAt.getTime() - now < policy.ttlMs - SLIDE_THRESHOLD_MS;
      if (extended) {
        await db.session.update({
          where: { id: session.id },
          data: { expiresAt: new Date(now + policy.ttlMs) },
        });
      }
      return { sessionId: session.id, userId: session.userId, kind, extended };
    },

    async revoke(sessionId: string) {
      await db.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async revokeToken(token: string) {
      await db.session.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    /** Used on password reset (all sessions) and password change (all except current). */
    async revokeAllForUser(userId: string, exceptSessionId?: string) {
      await db.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      });
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
