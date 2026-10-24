import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../../test-utils';
import { MembersPage } from './members-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wid = '11111111-1111-4111-8111-111111111111';
const members = [
  { id: 'm1', userId: 'u1', name: 'Olive Owner', avatarKey: null, role: 'OWNER', joinedAt: '' },
  { id: 'm2', userId: 'u2', name: 'Mo Member', avatarKey: null, role: 'MEMBER', joinedAt: '' },
];

function workspace(myRole: string) {
  return {
    workspace: {
      id: wid,
      name: 'Acme',
      slug: 'acme',
      timezone: 'UTC',
      status: 'ACTIVE',
      myRole,
      memberCount: 2,
      projectCount: 0,
      createdAt: '',
    },
  };
}

describe('MembersPage permission-aware UI', () => {
  it('Members see the roster read-only: no invite form, role controls or invitations', async () => {
    const fetchMock = stubApi({
      [`/workspaces/${wid}`]: workspace('MEMBER'),
      [`/workspaces/${wid}/members`]: { members },
      '/auth/me': {
        user: { id: 'u2', email: 'mo@x.test', name: 'Mo', timezone: 'UTC', emailVerified: true },
      },
    });
    renderAt(`/workspaces/${wid}/members`, '/workspaces/:wid/members', <MembersPage />);
    expect(await screen.findByText('Mo Member')).toBeTruthy();
    expect(screen.queryByText('Invite people')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/invitations'))).toBe(false);
  });

  it('Admins get invite and member controls, but never for the Owner', async () => {
    stubApi({
      [`/workspaces/${wid}`]: workspace('ADMIN'),
      [`/workspaces/${wid}/members`]: {
        members: members.map((m) => ({ ...m, email: `${m.userId}@x.test` })),
      },
      [`/workspaces/${wid}/invitations`]: { invitations: [] },
      '/auth/me': {
        user: { id: 'u3', email: 'a@x.test', name: 'Ada', timezone: 'UTC', emailVerified: true },
      },
    });
    renderAt(`/workspaces/${wid}/members`, '/workspaces/:wid/members', <MembersPage />);
    expect(await screen.findByText('Invite people')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getByLabelText('Role for Mo Member')).toBeTruthy();
    expect(screen.queryByLabelText('Role for Olive Owner')).toBeNull();
    expect(await screen.findByText('No pending invitations')).toBeTruthy();
  });

  it('shows a not-found state for a workspace the caller cannot see', async () => {
    stubApi({});
    renderAt(`/workspaces/${wid}/members`, '/workspaces/:wid/members', <MembersPage />);
    expect(await screen.findByText(/no longer have access/)).toBeTruthy();
  });
});
