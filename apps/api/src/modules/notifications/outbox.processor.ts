import type { OutboxEvent } from '@prisma/client';
import type { Logger } from 'pino';
import type { Db } from '../../lib/prisma.js';
import { HANDLERS, type DeliveryDeps, type Handler } from './delivery.js';

/** ADR-005 constants. */
export const OUTBOX_BATCH = 50;
export const OUTBOX_MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 30_000;
/**
 * A claimed event is hidden for this long. If a worker dies mid-batch the lease lapses and
 * another worker picks the event up again, so nothing is lost; handlers are idempotent.
 */
export const OUTBOX_LEASE_MS = 5 * 60_000;

export const backoffMs = (attempts: number) => 2 ** attempts * BACKOFF_BASE_MS;

/** Error text for lastError: bounded, with email addresses stripped (no personal data). */
export function safeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.replace(/[^\s@<>"']+@[^\s@<>"']+/g, '[email]').slice(0, 500);
}

/**
 * Claims up to `limit` due events. FOR UPDATE SKIP LOCKED makes concurrent workers take
 * disjoint rows; pushing availableAt forward is the lease that keeps them disjoint after commit.
 */
export function claimBatch(db: Db, limit = OUTBOX_BATCH) {
  return db.$queryRaw<OutboxEvent[]>`
    UPDATE "OutboxEvent"
       SET "availableAt" = (now() AT TIME ZONE 'UTC') + ${OUTBOX_LEASE_MS} * interval '1 millisecond'
     WHERE id IN (
       SELECT id FROM "OutboxEvent"
        WHERE status = 'PENDING' AND "availableAt" <= (now() AT TIME ZONE 'UTC')
        ORDER BY "availableAt", "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING *`;
}

export interface ProcessResult {
  processed: number;
  retried: number;
  dead: number;
}

export async function processOutboxBatch(
  deps: DeliveryDeps & { logger: Logger; handlers?: Record<string, Handler>; limit?: number },
): Promise<ProcessResult> {
  const { db, logger, handlers = HANDLERS } = deps;
  const result: ProcessResult = { processed: 0, retried: 0, dead: 0 };
  for (const event of await claimBatch(db, deps.limit)) {
    const log = { eventId: event.id, topic: event.topic };
    const handler = handlers[event.topic];
    if (!handler) {
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'DEAD', lastError: 'No handler for topic' },
      });
      logger.error({ ...log, event: 'outbox.dead' }, 'outbox event has no handler');
      result.dead++;
      continue;
    }
    try {
      await handler(event, deps);
      await db.outboxEvent.updateMany({
        where: { id: event.id, status: 'PENDING' },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      });
      result.processed++;
    } catch (err) {
      const attempts = event.attempts + 1;
      const dead = attempts >= OUTBOX_MAX_ATTEMPTS;
      await db.outboxEvent.update({
        where: { id: event.id },
        data: {
          attempts,
          status: dead ? 'DEAD' : 'PENDING',
          availableAt: new Date(Date.now() + backoffMs(attempts)),
          lastError: safeError(err),
        },
      });
      logger[dead ? 'error' : 'warn'](
        { ...log, attempts, event: dead ? 'outbox.dead' : 'outbox.retry' },
        dead ? 'outbox event failed permanently' : 'outbox event failed; will retry',
      );
      if (dead) result.dead++;
      else result.retried++;
    }
  }
  return result;
}
