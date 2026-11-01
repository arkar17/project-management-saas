import { ErrorCode } from '@pm/shared';
import { rateLimit } from 'express-rate-limit';

export interface RateLimitRule {
  windowMs: number;
  limit: number;
}

/**
 * Per-IP limiter returning the standard error envelope plus Retry-After (FR-AUTH-005).
 * Uses the in-memory store, which is correct for the single API process run in Release 1.0.
 */
export function rateLimiter(rule: RateLimitRule) {
  return rateLimit({
    ...rule,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many requests, try again later',
        requestId: String(req.id),
      });
    },
  });
}
