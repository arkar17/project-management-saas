/** Error envelope returned by every API error (Architecture v3 §6). */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

/** Machine-readable error codes; HTTP status mapping follows ADR-015. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FORBIDDEN: 'FORBIDDEN',
  FIELD_FORBIDDEN: 'FIELD_FORBIDDEN',
  CSRF_FAILED: 'CSRF_FAILED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  WORKSPACE_SUSPENDED: 'WORKSPACE_SUSPENDED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
