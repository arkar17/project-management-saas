import type { Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validates a response body against its shared DTO schema before sending. A mismatch is a
 * server bug, so it surfaces as a 500 (never a client 422) and the unvalidated body is dropped.
 */
export function sendDto<S extends ZodTypeAny>(
  res: Response,
  schema: S,
  body: z.input<S>,
  status = 200,
) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Response DTO validation failed: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  res.status(status).json(parsed.data);
}
