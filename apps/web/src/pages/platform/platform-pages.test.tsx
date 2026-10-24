import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../../test-utils';
import {
  PlatformDashboardPage,
  PlatformUsersPage,
  PlatformWorkspaceDetailPage,
} from './platform-pages';
import { PlatformShell } from './platform-shell';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wid = '11111111-1111-4111-8111-111111111111';
const me = {
  user: { id: wid, email: 'root@x.test', name: 'Root', timezone: 'UTC', emailVerified: true },
};
const workspace = {
  id: wid,
  name: 'Acme',
  slug: 'acme',
  status: 'ACTIVE',
  suspendedAt: null,
  timezone: 'UTC',
  createdAt: '2026-10-01T00:00:00Z',
  activeMembers: 3,
  projects: 2,
  owner: { id: wid, name: 'Olive' },
  archivedProjects: 1,
  pendingInvitations: 0,
};

describe('Platform admin UI (FR-ADM-001…004)', () => {
  it('redirects to the platform sign-in without a PLATFORM session', async () => {
    stubApi({});
    renderAt(
      '/platform',
      '/platform',
      <PlatformShell />,
      <Route index element={<p>secret dashboard</p>} />,
    );
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.queryByText('secret dashboard')).toBeNull();
  });

  it('shows aggregate metrics and job health', async () => {
    stubApi({
      '/platform/metrics': {
        workspaces: { total: 4, active: 3, suspended: 1 },
        users: { total: 9, active: 8 },
        activeMembers: 7,
        jobs: { pending: 2, dead: 1, retrying: 1, oldestPendingAt: null },
      },
    });
    renderAt('/x', '/x', <PlatformDashboardPage />);
    expect(await screen.findByText('Failed (dead)')).toBeTruthy();
    expect(screen.getByText('8 / 9')).toBeTruthy();
  });

  it('suspension needs explicit confirmation and a reason', async () => {
    const fetchMock = stubApi({
      [`/platform/workspaces/${wid}`]: { workspace, statusHistory: [] },
      '/auth/csrf': { csrfToken: 't' },
      [`/platform/workspaces/${wid}/suspend`]: { workspace: { ...workspace, status: 'SUSPENDED' } },
    });
    renderAt(
      `/platform/workspaces/${wid}`,
      '/platform/workspaces/:wid',
      <PlatformWorkspaceDetailPage />,
    );
    fireEvent.click(await screen.findByText('Suspend workspace…'));
    expect(screen.getByText('Suspend Acme?')).toBeTruthy();
    const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST');
    fireEvent.click(screen.getByText('Suspend', { selector: 'button' }));
    expect(posts()).toHaveLength(0); // no reason yet
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'Abuse report' },
    });
    fireEvent.click(screen.getByText('Suspend', { selector: 'button' }));
    await waitFor(() => expect(posts().some(([u]) => String(u).endsWith('/suspend'))).toBe(true));
    const [, init] = posts().find(([u]) => String(u).endsWith('/suspend'))!;
    expect(JSON.parse(String(init!.body))).toEqual({ reason: 'Abuse report' });
  });

  it('users are listed read-only', async () => {
    stubApi({
      '/platform/users': {
        users: [
          {
            id: wid,
            name: 'Root',
            email: 'root@x.test',
            status: 'ACTIVE',
            emailVerified: true,
            platformAdmin: true,
            activeWorkspaces: 0,
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
    renderAt('/x', '/x', <PlatformUsersPage />);
    expect(await screen.findByText('platform admin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /deactivate|delete|edit/i })).toBeNull();
    void me;
  });
});
