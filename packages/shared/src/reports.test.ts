import { describe, expect, it } from 'vitest';
import { computeProjectOverview } from './projects.js';
import {
  averageVelocity,
  computeBurndown,
  dateRange,
  dueBucket,
  localDate,
  startOfLocalDay,
  type BurndownInput,
} from './reports.js';

describe('TC-RPT-006-1 workspace-timezone day boundaries', () => {
  const instant = new Date('2026-10-24T20:30:00Z');

  it('maps one instant to different local days in two timezones', () => {
    expect(localDate(instant, 'UTC')).toBe('2026-10-24');
    expect(localDate(instant, 'Pacific/Auckland')).toBe('2026-10-25'); // UTC+13 (NZDT)
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2026-10-24'); // UTC-7
    expect(localDate(new Date('2026-10-25T06:59:59Z'), 'America/Los_Angeles')).toBe('2026-10-24');
    expect(localDate(new Date('2026-10-25T07:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-25');
  });

  it('finds local midnight in UTC, including across DST changes', () => {
    expect(startOfLocalDay('2026-10-25', 'America/Los_Angeles').toISOString()).toBe(
      '2026-10-25T07:00:00.000Z',
    );
    // US DST ends 2026-11-01: midnight is still PDT (UTC-7), the next midnight is PST (UTC-8).
    expect(startOfLocalDay('2026-11-01', 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-01T07:00:00.000Z',
    );
    expect(startOfLocalDay('2026-11-02', 'America/Los_Angeles').toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    );
    expect(startOfLocalDay('2026-10-25', 'Pacific/Auckland').toISOString()).toBe(
      '2026-10-24T11:00:00.000Z',
    );
    expect(dateRange('2026-10-30', '2026-11-02')).toHaveLength(4);
  });

  it('overdue depends on the workspace day, not the server day', () => {
    const issue = { status: 'TO_DO', dueAt: new Date('2026-10-24T10:00:00Z') };
    const now = new Date('2026-10-24T20:30:00Z');
    // Same instant: still "today" in Los Angeles, already yesterday in Auckland.
    expect(dueBucket(issue, localDate(now, 'America/Los_Angeles'), 'America/Los_Angeles')).toBe(
      'upcoming',
    );
    expect(dueBucket(issue, localDate(now, 'Pacific/Auckland'), 'Pacific/Auckland')).toBe(
      'overdue',
    );
  });
});

describe('TC-RPT-002-1 overdue rules', () => {
  it('excludes DONE and issues due today; counts by local day', () => {
    const now = new Date('2026-10-24T15:00:00Z');
    const r = computeProjectOverview(
      [
        { status: 'DONE', dueAt: new Date('2026-10-01T00:00:00Z') },
        { status: 'TO_DO', dueAt: new Date('2026-10-24T01:00:00Z') }, // earlier today: not overdue
        { status: 'TO_DO', dueAt: new Date('2026-10-23T23:59:59Z') }, // yesterday: overdue
        { status: 'TO_DO', dueAt: new Date('2026-10-31T23:59:59Z') }, // today + 7: upcoming
        { status: 'TO_DO', dueAt: new Date('2026-11-01T00:00:00Z') }, // later
      ],
      now,
      'UTC',
    );
    expect([r.overdueIssues, r.upcomingIssues, r.doneIssues]).toEqual([1, 2, 1]);
  });
});

describe('TC-RPT-003-1 burndown reconciles with history fixtures', () => {
  const tz = 'UTC';
  const t = (iso: string) => new Date(iso);
  const base: BurndownInput = {
    timezone: tz,
    startedAt: t('2026-10-20T09:00:00Z'),
    endAt: t('2026-10-24T17:00:00Z'),
    closedAt: null,
    now: t('2026-10-22T12:00:00Z'),
    rows: [
      // A (5) done on day 2; B (3) removed on day 3; C unestimated; D added on day 2.
      {
        issueId: 'A',
        addedAt: t('2026-10-19T00:00:00Z'),
        removedAt: null,
        committedAt: t('2026-10-20T09:00:00Z'),
        committedPoints: 5,
      },
      {
        issueId: 'B',
        addedAt: t('2026-10-19T00:00:00Z'),
        removedAt: t('2026-10-22T10:00:00Z'),
        committedAt: t('2026-10-20T09:00:00Z'),
        committedPoints: 3,
      },
      {
        issueId: 'C',
        addedAt: t('2026-10-19T00:00:00Z'),
        removedAt: null,
        committedAt: t('2026-10-20T09:00:00Z'),
        committedPoints: null,
      },
      {
        issueId: 'D',
        addedAt: t('2026-10-21T15:00:00Z'),
        removedAt: null,
        committedAt: null,
        committedPoints: null,
      },
    ],
    statusChanges: [
      { issueId: 'A', at: t('2026-10-21T16:00:00Z'), oldValue: 'IN_PROGRESS', newValue: 'DONE' },
    ],
    pointsChanges: [
      // D was estimated 2 when added; re-estimated 8 later — scope uses points at addition.
      { issueId: 'D', at: t('2026-10-22T08:00:00Z'), oldValue: '2', newValue: '8' },
    ],
    currentStatus: new Map([
      ['A', 'DONE'],
      ['B', 'TO_DO'],
      ['C', 'TO_DO'],
      ['D', 'TO_DO'],
    ]),
    currentPoints: new Map([
      ['A', 5],
      ['B', 3],
      ['C', null],
      ['D', 8],
    ]),
  };

  it('computes remaining, scope added and ideal; future days are null', () => {
    const r = computeBurndown(base);
    expect(r).toMatchObject({ from: '2026-10-20', to: '2026-10-24', committedPoints: 8 });
    expect(r.days.map((d) => [d.date, d.remainingCommittedPoints, d.scopeAddedPoints])).toEqual([
      ['2026-10-20', 8, 0],
      ['2026-10-21', 3, 2], // A done; D added with 2 points
      ['2026-10-22', 0, 0], // B removed today; C counts 0 (unestimated)
      ['2026-10-23', null, null],
      ['2026-10-24', null, null],
    ]);
    expect(r.days.map((d) => d.idealPoints)).toEqual([8, 6, 4, 2, 0]);
  });

  it('stays stable after completion even if issues change later', () => {
    const closedAt = t('2026-10-24T16:00:00Z');
    const completed = {
      ...base,
      closedAt,
      now: t('2026-10-30T12:00:00Z'),
      // C carried over at completion (removedAt = closedAt) still counts on the closing day.
      rows: base.rows.map((r) => (r.issueId === 'C' ? { ...r, removedAt: closedAt } : r)),
    };
    const before = computeBurndown(completed);
    // A is reopened after the sprint closed.
    const after = computeBurndown({
      ...completed,
      statusChanges: [
        ...completed.statusChanges,
        { issueId: 'A', at: t('2026-10-27T09:00:00Z'), oldValue: 'DONE', newValue: 'TO_DO' },
      ],
      currentStatus: new Map([...completed.currentStatus, ['A', 'TO_DO']]),
    });
    expect(after).toEqual(before);
    expect(before.to).toBe('2026-10-24');
    expect(before.days.at(-1)?.remainingCommittedPoints).toBe(0);
  });

  it('rebuilds status for issues with no change before the day from the first later change', () => {
    const r = computeBurndown({
      ...base,
      statusChanges: [
        { issueId: 'C', at: t('2026-10-22T09:00:00Z'), oldValue: 'TO_DO', newValue: 'DONE' },
      ],
      currentStatus: new Map([...base.currentStatus, ['A', 'IN_PROGRESS'], ['C', 'DONE']]),
    });
    expect(r.days[0]?.remainingCommittedPoints).toBe(8);
  });
});

describe('TC-RPT-004-1 velocity', () => {
  it('averages completed points and is zero-safe', () => {
    const s = (completedPoints: number) => ({
      id: String(completedPoints),
      name: 'S',
      closedAt: new Date(),
      committedPoints: 10,
      completedPoints,
    });
    expect(averageVelocity([s(8), s(13), s(5)])).toBe(8.7);
    expect(averageVelocity([])).toBe(0);
  });
});
