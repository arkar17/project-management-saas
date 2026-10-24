import type { Logger } from 'pino';
import type { Db } from '../../lib/prisma.js';
import { refreshActiveSprintMetrics } from '../reports/sprint-metrics.js';
import { expireInvitations } from '../workspaces/invitation.service.js';

/** Arbitrary constant naming the hourly-jobs advisory lock (ADR-018 single leader). */
const HOURLY_LOCK_KEY = 4_018_001;

/**
 * ADR-018 hourly jobs (invitation expiry, SprintDailyMetric for ACTIVE sprints), run by at most
 * one worker at a time: a transaction-scoped advisory lock is taken on the same connection as
 * the work and released automatically on commit. Returns null when another worker holds it.
 */
export async function runHourlyJobs(db: Db, logger: Logger) {
  return db.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
      SELECT pg_try_advisory_xact_lock(${HOURLY_LOCK_KEY}) AS locked`;
      if (!locked) return null;
      const expiredInvitations = await expireInvitations(tx);
      const sprintsMeasured = await refreshActiveSprintMetrics(tx);
      logger.info(
        { event: 'jobs.hourly', expiredInvitations, sprintsMeasured },
        'hourly jobs finished',
      );
      return { expiredInvitations, sprintsMeasured };
    },
    { timeout: 60_000 },
  );
}
