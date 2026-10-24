import { z } from 'zod';
import { ISSUE_STATUSES } from './issues.js';

// ---- Workspace-timezone day boundaries (ADR-018, FR-RPT-006) ----

const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds the zone is ahead of UTC at `at`. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Calendar date (YYYY-MM-DD) of an instant in the workspace timezone. */
export function localDate(at: Date, timeZone: string): string {
  return new Date(at.getTime() + zoneOffsetMs(at, timeZone)).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** UTC instant of local midnight starting `date` in the zone (DST-aware). */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const first = zoneOffsetMs(new Date(guess), timeZone);
  let at = guess - first;
  const second = zoneOffsetMs(new Date(at), timeZone);
  if (second !== first) at = guess - second;
  return new Date(at);
}

/** Dates from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const reportRange = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
});
export type ReportRange = z.infer<typeof reportRange>;

// ---- FR-RPT-002 overview metrics ----

export interface DueIssue {
  status: string;
  dueAt: Date | null;
}

/** Overdue = due before today (workspace tz) and not DONE; upcoming = due today … today+7. */
export function dueBucket(issue: DueIssue, today: string, timeZone: string) {
  if (issue.status === 'DONE' || !issue.dueAt) return null;
  const due = localDate(issue.dueAt, timeZone);
  if (due < today) return 'overdue' as const;
  if (due <= addDays(today, 7)) return 'upcoming' as const;
  return null;
}

// ---- FR-RPT-003 burndown ----

export interface BurndownHistoryRow {
  issueId: string;
  addedAt: Date;
  removedAt: Date | null;
  committedAt: Date | null;
  /** null = unestimated (ADR-003); counts as 0. */
  committedPoints: number | null;
}

export interface FieldChange {
  issueId: string;
  at: Date;
  oldValue: string | null;
  newValue: string | null;
}

export interface BurndownInput {
  timezone: string;
  startedAt: Date;
  endAt: Date;
  closedAt: Date | null;
  now: Date;
  rows: readonly BurndownHistoryRow[];
  /** IssueActivity rows for field 'status' / 'storyPoints' of the sprint's issues. */
  statusChanges: readonly FieldChange[];
  pointsChanges: readonly FieldChange[];
  currentStatus: ReadonlyMap<string, string>;
  currentPoints: ReadonlyMap<string, number | null>;
}

export interface BurndownDay {
  date: string;
  /** null for days that have not ended yet (or not started). */
  remainingCommittedPoints: number | null;
  scopeAddedPoints: number | null;
  idealPoints: number;
}

/**
 * A field's value at `at`, rebuilt from its change log: the last change at or before `at`,
 * else the old value of the first later change, else the current value. Later edits never
 * rewrite earlier days, so past values stay stable.
 */
function valueAt(changes: readonly FieldChange[] | undefined, at: Date, current: string | null) {
  if (!changes || changes.length === 0) return current;
  let last: FieldChange | undefined;
  for (const c of changes) {
    if (c.at.getTime() <= at.getTime()) last = c;
    else return last ? last.newValue : c.oldValue;
  }
  return last ? last.newValue : current;
}

function byIssue(changes: readonly FieldChange[]) {
  const map = new Map<string, FieldChange[]>();
  for (const c of [...changes].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const list = map.get(c.issueId) ?? [];
    list.push(c);
    map.set(c.issueId, list);
  }
  return map;
}

const toPoints = (v: string | null) => (v === null || v === '' ? null : Number(v));

/**
 * ADR-003 / FR-RPT-003. remainingCommittedPoints(day) = Σ committedPoints of committed issues
 * still in the sprint and not DONE at the end of that local day; scopeAddedPoints(day) = points,
 * at the time of addition, of issues added after start on that day. An issue removed (or
 * soft-deleted) leaves both series from its removal day; issues carried over at completion
 * (removedAt = closedAt) still count on the closing day.
 */
export function computeBurndown(input: BurndownInput) {
  const { timezone: tz, startedAt, closedAt, now } = input;
  const from = localDate(startedAt, tz);
  const plannedEnd = localDate(input.endAt, tz);
  const today = localDate(now, tz);
  const to = closedAt
    ? localDate(closedAt, tz)
    : today > plannedEnd
      ? today
      : plannedEnd < from
        ? from
        : plannedEnd;
  const status = byIssue(input.statusChanges);
  const points = byIssue(input.pointsChanges);
  const committed = input.rows.filter((r) => r.committedAt);
  const committedTotal = committed.reduce((s, r) => s + (r.committedPoints ?? 0), 0);
  const idealSpan = Math.max(0, dateRange(from, plannedEnd).length - 1);

  const inSprintOn = (r: BurndownHistoryRow, day: string) =>
    !r.removedAt ||
    (closedAt !== null && r.removedAt.getTime() === closedAt.getTime()) ||
    localDate(r.removedAt, tz) > day;

  const days: BurndownDay[] = dateRange(from, to).map((date, i) => {
    const idealPoints = idealSpan === 0 ? 0 : Math.max(0, committedTotal * (1 - i / idealSpan));
    if (date > today) {
      return { date, remainingCommittedPoints: null, scopeAddedPoints: null, idealPoints };
    }
    let cutoff = startOfLocalDay(addDays(date, 1), tz);
    if (closedAt && closedAt < cutoff) cutoff = closedAt;
    if (now < cutoff) cutoff = now;
    let remaining = 0;
    for (const r of committed) {
      if (!inSprintOn(r, date)) continue;
      const s = valueAt(status.get(r.issueId), cutoff, input.currentStatus.get(r.issueId) ?? null);
      if (s !== 'DONE') remaining += r.committedPoints ?? 0;
    }
    let scopeAdded = 0;
    for (const r of input.rows) {
      if (r.committedAt || r.addedAt < startedAt || localDate(r.addedAt, tz) !== date) continue;
      const current = input.currentPoints.get(r.issueId);
      const p = toPoints(
        valueAt(
          points.get(r.issueId),
          r.addedAt,
          current === undefined || current === null ? null : String(current),
        ),
      );
      scopeAdded += p ?? 0;
    }
    return { date, remainingCommittedPoints: remaining, scopeAddedPoints: scopeAdded, idealPoints };
  });
  return { from, to, committedPoints: committedTotal, days };
}

// ---- FR-RPT-004 velocity ----

export const VELOCITY_DEFAULT_SPRINTS = 6;

export interface VelocitySprint {
  id: string;
  name: string;
  closedAt: Date;
  committedPoints: number;
  completedPoints: number;
}

/** Average completed points over the given COMPLETED sprints (0 when there are none). */
export function averageVelocity(sprints: readonly VelocitySprint[]): number {
  if (sprints.length === 0) return 0;
  const total = sprints.reduce((s, x) => s + x.completedPoints, 0);
  return Math.round((total / sprints.length) * 10) / 10;
}

// ---- DTOs ----

const countMap = z.record(z.string(), z.number().int());
const userRef = z.object({ id: z.string().uuid(), name: z.string() });
const issueRef = z.object({ id: z.string().uuid(), key: z.string(), title: z.string() });

export const workspaceOverviewDto = z.object({
  range: reportRange,
  totals: z.object({
    projects: z.number().int(),
    issues: z.number().int(),
    open: z.number().int(),
    done: z.number().int(),
    overdue: z.number().int(),
    upcoming: z.number().int(),
  }),
  byStatus: countMap,
  projects: z.array(
    z.object({
      id: z.string().uuid(),
      key: z.string(),
      name: z.string(),
      issues: z.number().int(),
      open: z.number().int(),
      done: z.number().int(),
      overdue: z.number().int(),
      progressPercent: z.number().int(),
    }),
  ),
  upcoming: z.array(
    issueRef.extend({
      projectId: z.string().uuid(),
      dueAt: z.string(),
      status: z.enum(ISSUE_STATUSES),
      assignee: userRef.nullable(),
    }),
  ),
});
export type WorkspaceOverviewDto = z.infer<typeof workspaceOverviewDto>;

export const burndownDto = z.object({
  range: reportRange,
  sprint: z.object({
    id: z.string().uuid(),
    name: z.string(),
    status: z.string(),
    startAt: z.string(),
    endAt: z.string(),
  }),
  committedPoints: z.number().int(),
  days: z.array(
    z.object({
      date: z.string(),
      remainingCommittedPoints: z.number().nullable(),
      scopeAddedPoints: z.number().nullable(),
      idealPoints: z.number(),
    }),
  ),
  /** Sprint issues without an estimate; they count as 0 (FR-RPT-003). */
  unestimated: z.array(issueRef.extend({ committed: z.boolean() })),
});
export type BurndownDto = z.infer<typeof burndownDto>;

export const velocityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(VELOCITY_DEFAULT_SPRINTS),
});

export const velocityDto = z.object({
  range: reportRange,
  averageCompletedPoints: z.number(),
  sprints: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      closedAt: z.string(),
      committedPoints: z.number().int(),
      completedPoints: z.number().int(),
      unestimatedCompleted: z.number().int(),
    }),
  ),
});
export type VelocityDto = z.infer<typeof velocityDto>;

export const workloadDto = z.object({
  range: reportRange,
  archived: z.boolean(),
  rows: z.array(
    z.object({
      assignee: userRef.nullable(),
      /** False when the assignee no longer has ACTIVE access to the project. */
      activeMember: z.boolean(),
      openIssues: z.number().int(),
      points: z.number().int(),
      unestimated: z.number().int(),
    }),
  ),
});
export type WorkloadDto = z.infer<typeof workloadDto>;
