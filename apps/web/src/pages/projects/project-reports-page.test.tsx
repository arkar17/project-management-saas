import { cleanup, screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../../test-utils';
import { SprintBurndown } from '../sprints/sprint-burndown';
import { WorkspaceOverviewPage } from '../workspaces/workspace-overview-page';
import { ProjectLayout } from './project-layout';
import { ProjectReportsPage } from './project-reports-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wid = '11111111-1111-4111-8111-111111111111';
const pid = '22222222-2222-4222-8222-222222222222';
const sid = '33333333-3333-4333-8333-333333333333';
const range = { timezone: 'America/Los_Angeles', from: '2026-10-20', to: '2026-10-24' };
const project = {
  id: pid,
  workspaceId: wid,
  key: 'WEB',
  name: 'Web',
  description: null,
  status: 'ACTIVE',
  startDate: null,
  targetDate: null,
  archivedAt: null,
  createdAt: '',
  myAccess: 'PROJECT_MEMBER',
};
const overview = {
  totalIssues: 4,
  byStatus: { DONE: 1, TO_DO: 3 },
  doneIssues: 1,
  progressPercent: 25,
  overdueIssues: 1,
  upcomingIssues: 0,
  memberCount: 2,
  activeSprint: { id: sid, name: 'S1', endAt: '2026-10-24T00:00:00Z' },
  byType: { TASK: 4 },
  byPriority: { MEDIUM: 3, HIGH: 1 },
  range,
};
const burndown = {
  range,
  sprint: { id: sid, name: 'S1', status: 'ACTIVE', startAt: '', endAt: '' },
  committedPoints: 8,
  days: [
    { date: '2026-10-20', remainingCommittedPoints: 8, scopeAddedPoints: 0, idealPoints: 8 },
    { date: '2026-10-21', remainingCommittedPoints: 3, scopeAddedPoints: 2, idealPoints: 4 },
    { date: '2026-10-22', remainingCommittedPoints: null, scopeAddedPoints: null, idealPoints: 0 },
  ],
  unestimated: [{ id: sid, key: 'WEB-3', title: 'Spike', committed: true }],
};

describe('Reports UI (FR-RPT-001…006)', () => {
  it('project reports: distributions, burndown, empty velocity, workload with unassigned', async () => {
    stubApi({
      [`/projects/${pid}`]: { project },
      [`/projects/${pid}/reports/overview`]: { overview },
      [`/sprints/${sid}/burndown`]: burndown,
      [`/projects/${pid}/reports/velocity`]: { range, averageCompletedPoints: 0, sprints: [] },
      [`/projects/${pid}/reports/workload`]: {
        range,
        archived: false,
        rows: [
          {
            assignee: { id: sid, name: 'Pat' },
            activeMember: false,
            openIssues: 2,
            points: 5,
            unestimated: 1,
          },
          { assignee: null, activeMember: true, openIssues: 1, points: 2, unestimated: 0 },
        ],
      },
    });
    renderAt(
      `/workspaces/${wid}/projects/${pid}/reports`,
      '/workspaces/:wid/projects/:pid',
      <ProjectLayout />,
      <Route path="reports" element={<ProjectReportsPage />} />,
    );
    expect(await screen.findByText('Status · 25% done')).toBeTruthy();
    expect(
      screen.getAllByText(/America\/Los Angeles|America\/Los_Angeles|Los Angeles time/).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByLabelText('Sprint burndown chart')).toBeTruthy();
    expect(screen.getByText('1 unestimated issue (counted as 0 points)')).toBeTruthy();
    expect(await screen.findByText(/Complete a sprint to see velocity/)).toBeTruthy();
    expect(await screen.findByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('(no project access)')).toBeTruthy();
  });

  it('burndown of a planned sprint shows an empty state', async () => {
    stubApi({ [`/sprints/${sid}/burndown`]: { ...burndown, days: [], unestimated: [] } });
    renderAt('/x', '/x', <SprintBurndown sid={sid} />);
    expect(await screen.findByText('The burndown starts when the sprint starts.')).toBeTruthy();
  });

  it('workspace dashboard: empty state when the caller has no readable projects', async () => {
    stubApi({
      [`/workspaces/${wid}`]: {
        workspace: {
          id: wid,
          name: 'Acme',
          slug: 'acme',
          timezone: 'UTC',
          status: 'ACTIVE',
          myRole: 'MEMBER',
          memberCount: 3,
          projectCount: 0,
        },
      },
      [`/workspaces/${wid}/overview`]: {
        range,
        totals: { projects: 0, issues: 0, open: 0, done: 0, overdue: 0, upcoming: 0 },
        byStatus: {},
        projects: [],
        upcoming: [],
      },
    });
    renderAt(`/workspaces/${wid}`, '/workspaces/:wid', <WorkspaceOverviewPage />);
    expect(await screen.findByText('No projects to report on')).toBeTruthy();
  });
});
