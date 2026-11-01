import { ErrorCode } from '@pm/shared';

/** An error that maps directly to an HTTP response (ADR-015). */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthenticated = () =>
  new AppError(401, ErrorCode.UNAUTHENTICATED, 'Authentication required');
export const forbidden = (code: string = ErrorCode.FORBIDDEN, message = 'Action not permitted') =>
  new AppError(403, code, message);
/** Hidden and absent resources are indistinguishable to the caller (ADR-015). */
export const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Resource not found');
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const tokenExpired = () =>
  new AppError(410, ErrorCode.TOKEN_EXPIRED, 'This link is invalid or has expired');
