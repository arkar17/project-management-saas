import { computeBurndown, localDate, type FieldChange } from '@pm/shared';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Loads a sprint's history and status/points change log (three queries, no per-issue lookups)
 * and computes its burndown in the workspace timezone (ADR-003/018).
 */
export async function loadBurndown(tx: Tx, sprintId: string, now = new Date()) {
  const sprint = await tx.sprint.findUniqueOrThrow({
    where: { id: sprintId },
    include: { project: { select: { workspace: { select: { timezone: true } } } } },
  });
  const timezone = sprint.project.workspace.timezone;
  const rows = await tx.sprintIssueHistory.findMany({
    where: { sprintId },
    include: {
      issue: { select: { id: true, key: true, title: true, status: true, storyPoints: true } },
    },
  });
  const activity = await tx.issueActivity.findMany({
    where: {
      issueId: { in: rows.map((r) => r.issueId) },
      field: { in: ['status', 'storyPoints'] },
    },
    select: { issueId: true, field: true, oldValue: true, newValue: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const changes = (field: string): FieldChange[] =>
    activity
      .filter((a) => a.field === field)
      .map((a) => ({
        issueId: a.issueId,
        at: a.createdAt,
        oldValue: a.oldValue,
        newValue: a.newValue,
      }));

  const result = sprint.startedAt
    ? computeBurndown({
        timezone,
        startedAt: sprint.startedAt,
        endAt: sprint.endAt,
        closedAt: sprint.closedAt,
        now,
        rows,
        statusChanges: changes('status'),
        pointsChanges: changes('storyPoints'),
        currentStatus: new Map(rows.map((r) => [r.issueId, r.issue.status])),
        currentPoints: new Map(rows.map((r) => [r.issueId, r.issue.storyPoints])),
      })
    : {
        from: localDate(sprint.startAt, timezone),
        to: localDate(sprint.endAt, timezone),
        committedPoints: 0,
        days: [],
      };

  // Unestimated: committed with a null snapshot, or added after start without points.
  const unestimated = rows
    .filter((r) =>
      r.committedAt
        ? r.committedPoints === null
        : sprint.startedAt !== null &&
          r.addedAt >= sprint.startedAt &&
          r.issue.storyPoints === null,
    )
    .map((r) => ({
      id: r.issue.id,
      key: r.issue.key,
      title: r.issue.title,
      committed: r.committedAt !== null,
    }));

  return { sprint, timezone, ...result, unestimated, today: localDate(now, timezone) };
}

/**
 * Idempotent upsert on (sprintId, metricDate) for every *completed* local day (ADR-018); at
 * completion the closing day is final too. Rows for dates no longer in range (after a timezone
 * change) are removed: SprintDailyMetric is a recomputable cache (ADR-003).
 */
export async function writeSprintMetrics(tx: Tx, sprintId: string, now = new Date()) {
  const b = await loadBurndown(tx, sprintId, now);
  const closed = b.sprint.status === 'COMPLETED';
  const days = b.days.filter(
    (d) => d.remainingCommittedPoints !== null && (closed || d.date < b.today),
  );
  for (const d of days) {
    await tx.$executeRaw`
      INSERT INTO "SprintDailyMetric"
        (id, "sprintId", "metricDate", "remainingCommittedPoints", "scopeAddedPoints", "computedAt")
      VALUES (gen_random_uuid(), ${sprintId}::uuid, ${d.date}::date,
              ${d.remainingCommittedPoints}, ${d.scopeAddedPoints ?? 0}, now() AT TIME ZONE 'UTC')
      ON CONFLICT ("sprintId", "metricDate") DO UPDATE
        SET "remainingCommittedPoints" = EXCLUDED."remainingCommittedPoints",
            "scopeAddedPoints" = EXCLUDED."scopeAddedPoints",
            "computedAt" = EXCLUDED."computedAt"`;
  }
  await tx.sprintDailyMetric.deleteMany({
    where: {
      sprintId,
      metricDate: { notIn: days.map((d) => new Date(`${d.date}T00:00:00Z`)) },
    },
  });
  return days.length;
}

/** Hourly job body: refresh metrics of every ACTIVE sprint. Returns the number of sprints. */
export async function refreshActiveSprintMetrics(tx: Tx, now = new Date()) {
  const active = await tx.sprint.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  for (const s of active) await writeSprintMetrics(tx, s.id, now);
  return active.length;
}
