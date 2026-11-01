import { cleanup, screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../../test-utils';
import { ProjectLayout } from '../projects/project-layout';
import { IssueDetailPage } from './issue-detail-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wid = '11111111-1111-4111-8111-111111111111';
const pid = '22222222-2222-4222-8222-222222222222';
const iid = '33333333-3333-4333-8333-333333333333';
const me = { id: '44444444-4444-4444-8444-444444444444', name: 'Mo' };
const other = { id: '55555555-5555-4555-8555-555555555555', name: 'Pat' };

function issue(reporter = me) {
  return {
    id: iid,
    projectId: pid,
    key: 'WEB-7',
    number: 7,
    type: 'TASK',
    title: 'Fix login',
    description: null,
    status: 'TO_DO',
    priority: 'MEDIUM',
    reporter,
    assignee: null,
    parent: null,
    sprintId: null,
    storyPoints: null,
    rank: 'i',
    version: 3,
    dueAt: null,
    deletedAt: null,
    labels: [],
    childCount: 0,
    createdAt: '2026-10-24T00:00:00Z',
    updatedAt: '',
  };
}

function render(reporter = me, comments: unknown[] = []) {
  stubApi({
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
        myAccess: 'PROJECT_MEMBER',
      },
    },
    [`/issues/${iid}`]: { issue: issue(reporter) },
    [`/issues/${iid}/comments`]: { comments },
    [`/issues/${iid}/children`]: { issues: [] },
    [`/issues/${iid}/activity`]: { activity: [] },
    [`/issues/${iid}/watchers`]: { watchers: [me], watching: true },
    [`/projects/${pid}/labels`]: { labels: [] },
    [`/projects/${pid}/members`]: { members: [] },
    [`/projects/${pid}/issues`]: { issues: [], total: 0, page: 1, pageSize: 100 },
    [`/workspaces/${wid}/members`]: { members: [] },
  });
  renderAt(
    `/workspaces/${wid}/projects/${pid}/issues/${iid}`,
    '/workspaces/:wid/projects/:pid',
    <ProjectLayout />,
    <Route path="issues/:iid" element={<IssueDetailPage />} />,
  );
}

const disabled = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).disabled;

describe('IssueDetailPage field permissions (ADR-008)', () => {
  it('a Member on their own issue can edit title/description/status/due date only', async () => {
    render(me);
    expect(await screen.findByText('Save changes')).toBeTruthy();
    expect([disabled('Title'), disabled('Status'), disabled('Due date')]).toEqual([
      false,
      false,
      false,
    ]);
    expect([
      disabled('Priority'),
      disabled('Assignee'),
      disabled('Type'),
      disabled('Story points'),
    ]).toEqual([true, true, true, true]);
    expect(screen.queryByText('Delete issue…')).toBeNull();
  });

  it("a Member on someone else's issue gets a read-only form but can still comment", async () => {
    render(other);
    expect(await screen.findByText('You can view this issue but not edit it.')).toBeTruthy();
    expect(disabled('Title')).toBe(true);
    expect(screen.getByLabelText('Add a comment')).toBeTruthy();
  });

  it('removed comments render a placeholder, never a body', async () => {
    render(me, [
      {
        id: 'c1',
        author: other,
        body: null,
        removed: true,
        moderated: true,
        createdAt: '2026-10-24T00:00:00Z',
        editedAt: null,
      },
    ]);
    expect(await screen.findByText('Comment removed by a moderator')).toBeTruthy();
  });
});
