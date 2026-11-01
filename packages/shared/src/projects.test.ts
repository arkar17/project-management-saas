import { describe, expect, it } from 'vitest';
import {
  computeProjectOverview,
  createProjectInput,
  suggestProjectKey,
  updateProjectInput,
} from './projects.js';

describe('project contracts', () => {
  it('TC-PRJ-001-1 key format, default status ACTIVE, start ≤ target', () => {
    const ok = createProjectInput.parse({ key: 'web2', name: 'Web' });
    expect(ok).toMatchObject({ key: 'WEB2', status: 'ACTIVE' });
    for (const key of ['A', 'TOO-LONG-KEY', 'ABCDEFGHIJK', 'AB_C']) {
      expect(createProjectInput.safeParse({ key, name: 'Web' }).success, key).toBe(false);
    }
    expect(
      createProjectInput.safeParse({
        key: 'AB',
        name: 'Web',
        startDate: '2026-11-02',
        targetDate: '2026-11-01',
      }).success,
    ).toBe(false);
    expect(
      createProjectInput.safeParse({
        key: 'AB',
        name: 'Web',
        startDate: '2026-11-01',
        targetDate: '2026-11-01',
      }).success,
    ).toBe(true);
  });

  it('TC-PRJ-001-2 update rejects the immutable key', () => {
    expect(updateProjectInput.safeParse({ key: 'NEW' }).success).toBe(false);
    expect(updateProjectInput.safeParse({ name: 'Renamed', key: 'NEW' }).success).toBe(false);
    expect(updateProjectInput.safeParse({ name: 'Renamed' }).success).toBe(true);
  });

  it('suggests keys from names', () => {
    expect(suggestProjectKey('Mobile App Redesign')).toBe('MAR');
    expect(suggestProjectKey('website')).toBe('WEBSITE');
  });
});

describe('TC-PRJ-005-1 overview metrics', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);

  it('counts status, progress, overdue and upcoming from fixtures', () => {
    const result = computeProjectOverview(
      [
        { status: 'DONE', dueAt: at(-3) }, // done: never overdue
        { status: 'DONE', dueAt: null },
        { status: 'IN_PROGRESS', dueAt: at(-1) }, // overdue
        { status: 'TO_DO', dueAt: at(2) }, // upcoming
        { status: 'TO_DO', dueAt: at(7) }, // upcoming (boundary)
        { status: 'BACKLOG', dueAt: at(8) }, // later
        { status: 'BACKLOG', dueAt: null },
        { status: 'IN_REVIEW', dueAt: at(-10) }, // overdue
      ],
      now,
    );
    expect(result).toEqual({
      totalIssues: 8,
      byStatus: { DONE: 2, IN_PROGRESS: 1, TO_DO: 2, BACKLOG: 2, IN_REVIEW: 1 },
      doneIssues: 2,
      progressPercent: 25,
      overdueIssues: 2,
      upcomingIssues: 2,
    });
  });

  it('is zero-safe for empty projects', () => {
    expect(computeProjectOverview([], now).progressPercent).toBe(0);
  });
});
