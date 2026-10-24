import type { Logger } from 'pino';
import type { Mailer } from './lib/mailer.js';
import type { Db } from './lib/prisma.js';
import { processOutboxBatch, OUTBOX_BATCH } from './modules/notifications/outbox.processor.js';
import { runHourlyJobs } from './modules/notifications/scheduled-jobs.js';

export { processOutboxBatch } from './modules/notifications/outbox.processor.js';
export { runHourlyJobs } from './modules/notifications/scheduled-jobs.js';
export { loadWorkerEnv } from './config/env.js';
export { createLogger } from './lib/logger.js';
export { createSmtpMailer } from './lib/mailer.js';
export { createPrisma } from './lib/prisma.js';

export interface WorkerDeps {
  db: Db;
  mailer: Mailer;
  logger: Logger;
  appBaseUrl: string;
  pollMs?: number;
  hourlyMs?: number;
}

/**
 * apps/worker runtime (ADR-005/018): polls the outbox and runs the hourly jobs. Several
 * instances may run; SKIP LOCKED leases and the advisory lock keep their work disjoint.
 */
export function createWorker({
  db,
  mailer,
  logger,
  appBaseUrl,
  pollMs = 2000,
  hourlyMs = 60 * 60 * 1000,
}: WorkerDeps) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let hourly: NodeJS.Timeout | undefined;

  async function drain() {
    // Keep going while full batches come back; otherwise wait for the next poll.
    for (;;) {
      const r = await processOutboxBatch({ db, mailer, logger, appBaseUrl });
      if (stopped || r.processed + r.retried + r.dead < OUTBOX_BATCH) return;
    }
  }

  async function loop() {
    try {
      await drain();
    } catch (err) {
      logger.error(
        { event: 'worker.poll_failed', err: { name: (err as Error).name } },
        'poll failed',
      );
    }
    if (!stopped) timer = setTimeout(() => void loop(), pollMs);
  }

  const hourlyTick = () =>
    runHourlyJobs(db, logger).catch((err: unknown) =>
      logger.error(
        { event: 'jobs.failed', err: { name: (err as Error).name } },
        'hourly jobs failed',
      ),
    );

  return {
    start() {
      void loop();
      void hourlyTick();
      hourly = setInterval(() => void hourlyTick(), hourlyMs);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(hourly);
    },
  };
}
