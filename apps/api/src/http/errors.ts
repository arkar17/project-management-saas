import { ErrorCode, type ApiErrorBody } from '@pm/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, notFound } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = () => {
  throw notFound();
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id);
  let status = 500;
  let body: ApiErrorBody = {
    code: ErrorCode.INTERNAL,
    message: 'Internal server error',
    requestId,
  };

  if (err instanceof AppError) {
    status = err.status;
    body = { code: err.code, message: err.message, details: err.details, requestId };
  } else if (err instanceof ZodError) {
    status = 422;
    body = {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Request validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      requestId,
    };
  } else if (isBodyParserError(err)) {
    status = 422;
    body = { code: ErrorCode.VALIDATION_ERROR, message: 'Malformed request body', requestId };
  }

  if (status >= 500) req.log.error({ err }, 'unhandled error');
  res.status(status).json(body);
};

function isBodyParserError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}
