import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

/** Replaces req.body with the parsed DTO; ZodError becomes a 422 in the error handler. */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body ?? {});
    next();
  };
}
