import { CSRF_COOKIE, CSRF_HEADER, ErrorCode } from '@pm/shared';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { forbidden } from '../lib/errors.js';
import { newToken, safeEqual } from '../lib/tokens.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Readable by the SPA so it can echo the value in X-CSRF-Token (double-submit, ADR-001).
const csrfCookieOptions: CookieOptions = {
  httpOnly: false,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

export function issueCsrfToken(res: Response): string {
  const token = newToken();
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions);
  return token;
}

/** Every mutating request needs an allow-listed Origin and a matching CSRF header + cookie. */
export function csrfProtection(allowedOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    const header = req.get(CSRF_HEADER);
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const valid =
      origin !== undefined &&
      allowedOrigins.includes(origin) &&
      typeof header === 'string' &&
      typeof cookie === 'string' &&
      safeEqual(header, cookie);
    if (!valid) throw forbidden(ErrorCode.CSRF_FAILED, 'CSRF validation failed');
    next();
  };
}
