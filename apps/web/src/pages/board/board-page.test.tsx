import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../../test-utils';
import { ProjectLayout } from '../projects/project-layout';
import { SprintDetailPage } from '../sprints/sprint-detail-page';
import { BoardPage } from './board-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wid = '11111111-1111-4111-8111-111111111111';
const pid = '22222222-2222-4222-8222-222222222222';
const sid = '66666666-6666-4666-8666-666666666666';
const me = { id: '44444444-4444-4444-8444-444444444444', name: 'Mo' };
const pat = { id: '55555555-5555-4555-8555-555555555555', name: 'Pat' };

const issue = (id: string, key: string, status: string, reporter: typeof me) => ({
  id,
  projectId: pid,
  key,
  number: 1,
  type: 'TASK',
  title: `Title ${key}`,
  description: null,
  status,
  priority: 'MEDIUM',
  reporter,
  assignee: null,
  parent: null,
  sprintId: null,
  storyPoints: null,
  rank: 'i',
  version: 2,
  dueAt: null,
  deletedAt: null,
  labels: [],
  childCount: 0,
  createdAt: '',
  updatedAt: '',
});
const mine = issue('a1111111-1111-4111-8111-111111111111', 'WEB-1', 'TO_DO', me);
const theirs = issue('b2222222-2222-4222-8222-222222222222', 'WEB-2', 'TO_DO', pat);

function setup(myAccess: string) {
  const fetchMock = stubApi({
    '/auth/me': { user: { ...me, email: 'mo@x.test', timezone: 'UTC', emailVerified: true } },
    [`/projects/${pid}`]: {
      project: {
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
        myAccess,
      },
    },
    [`/projects/${pid}/board`]: {
      sprint: null,
      columns: ['BACKLOG', 'TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'].map((s) => ({
        status: s,
        issues: s === 'TO_DO' ? [mine, theirs] : [],
      })),
    },
    [`/projects/${pid}/labels`]: { labels: [] },
    [`/issues/${mine.id}/status`]: { issue: mine },
  });
  renderAt(
    `/workspaces/${wid}/projects/${pid}/board`,
    '/workspaces/:wid/projects/:pid',
    <ProjectLayout />,
    <Route path="board" element={<BoardPage />} />,
  );
  return fetchMock;
}

describe('BoardPage', () => {
  it('TC-BRD-004-1 keyboard "Move to" works without drag; Members only on own issues and without position', async () => {
    const fetchMock = setup('PROJECT_MEMBER');
    const select = await screen.findByLabelText('Move WEB-1 to');
    expect(screen.queryByLabelText('Move WEB-2 to')).toBeNull();
    expect(screen.queryByLabelText('Move WEB-1 up')).toBeNull();
    fireEvent.change(select, { target: { value: 'IN_PROGRESS' } });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith(`/issues/${mine.id}/status`)),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/status'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      version: 2,
      status: 'IN_PROGRESS',
    });
  });

  it('PMs get move controls and reorder buttons on every card', async () => {
    setup('PROJECT_MANAGER');
    expect(await screen.findByLabelText('Move WEB-2 to')).toBeTruthy();
    expect((screen.getByLabelText('Move WEB-1 up') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Move WEB-1 down') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Sprint completion dialog', () => {
  it('requires choosing a destination and sends it explicitly', async () => {
    const sprint = {
      id: sid,
      projectId: pid,
      name: 'S1',
      goal: null,
      status: 'ACTIVE',
      startAt: '2026-10-20T00:00:00Z',
      endAt: '2026-11-03T00:00:00Z',
      startedAt: '2026-10-20T00:00:00Z',
      closedAt: null,
      cancelledAt: null,
      issueCount: 1,
      points: 0,
    };
    const fetchMock = stubApi({
      '/auth/me': { user: { ...me, email: 'mo@x.test', timezone: 'UTC', emailVerified: true } },
      [`/projects/${pid}`]: {
        project: {
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
          myAccess: 'PROJECT_MANAGER',
        },
      },
      [`/sprints/${sid}`]: { sprint, issues: [mine] },
      [`/sprints/${sid}/report`]: {
        sprint,
        committedIssues: 1,
        committedPoints: 0,
        addedAfterStart: 0,
        removedDuringSprint: 0,
        completedIssues: 0,
        completedPoints: 0,
        carriedOver: 0,
      },
      [`/projects/${pid}/sprints`]: { sprints: [sprint] },
      [`/sprints/${sid}/complete`]: { sprint: { ...sprint, status: 'COMPLETED' }, issues: [] },
    });
    renderAt(
      `/workspaces/${wid}/projects/${pid}/sprints/${sid}`,
      '/workspaces/:wid/projects/:pid',
      <ProjectLayout />,
      <Route path="sprints/:sid" element={<SprintDetailPage />} />,
    );
    fireEvent.click(await screen.findByText('Complete sprint…'));
    expect(screen.getByLabelText('Move unfinished issues to')).toBeTruthy();
    fireEvent.click(screen.getByText('Complete sprint'));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/complete'))).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/complete'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      destination: { type: 'backlog' },
    });
  });
});
