import type { Prisma } from '@prisma/client';

/** Email topics delivered by apps/worker; payloads carry reference IDs only (ADR-005). */
export const EmailTopic = {
  VERIFY: 'email.verify',
  PASSWORD_RESET: 'email.password_reset',
  ACCOUNT_EXISTS: 'email.account_exists',
  INVITATION: 'email.invitation',
} as const;

/** Writes an outbox row in the caller's transaction so it commits or rolls back with the change. */
export function enqueue(
  tx: Prisma.TransactionClient,
  topic: string,
  aggregateId: string,
  payload: Prisma.InputJsonObject,
) {
  return tx.outboxEvent.create({ data: { topic, aggregateId, payload } });
}
