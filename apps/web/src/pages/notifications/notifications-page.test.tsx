import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, stubApi } from '../../test-utils';
import { NotificationsPage, describeNotification, notificationHref } from './notifications-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wid = '11111111-1111-4111-8111-111111111111';
const pid = '22222222-2222-4222-8222-222222222222';
const base = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'ASSIGNED' as const,
  workspaceId: wid,
  projectId: pid,
  issue: { id: '44444444-4444-4444-8444-444444444444', key: 'WEB-7', title: 'Fix login' },
  actor: { id: '55555555-5555-4555-8555-555555555555', name: 'Pat' },
  fields: [],
  readAt: null,
  createdAt: '2026-10-24T00:00:00Z',
};
const page = (notifications: unknown[]) => ({
  notifications,
  total: notifications.length,
  page: 1,
  pageSize: 25,
});
const mount = () => renderAt('/notifications', '/notifications', <NotificationsPage />);

describe('NotificationsPage (FR-NTF-002)', () => {
  it('describes each type and links only to the authorized resource', () => {
    expect(describeNotification(base)).toBe('Pat assigned you WEB-7 · Fix login');
    expect(
      describeNotification({
        ...base,
        type: 'WATCHED_ISSUE_UPDATED',
        fields: ['status', 'assigneeId'],
      }),
    ).toBe('Pat changed the status and assignee of WEB-7 · Fix login');
    expect(
      describeNotification({ ...base, type: 'WATCHED_ISSUE_UPDATED', fields: ['comment'] }),
    ).toMatch(/commented on/);
    expect(notificationHref(base)).toBe(
      `/workspaces/${wid}/projects/${pid}/issues/${base.issue.id}`,
    );
    const invite = { ...base, type: 'INVITE_ACCEPTED' as const, projectId: null, issue: null };
    expect(describeNotification(invite)).toBe('Pat accepted your invitation');
    expect(notificationHref(invite)).toBe(`/workspaces/${wid}/members`);
  });

  it('lists notifications and marks one read', async () => {
    const fetchMock = stubApi({
      '/notifications': page([base]),
      '/auth/csrf': { csrfToken: 't' },
      [`/notifications/${base.id}/read`]: new Response(null, { status: 204 }),
    });
    mount();
    expect(await screen.findByText('Pat assigned you WEB-7 · Fix login')).toBeTruthy();
    fireEvent.click(screen.getByText('Mark read'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => u === `/api/v1/notifications/${base.id}/read` && i?.method === 'PATCH',
        ),
      ).toBe(true),
    );
  });

  it('shows empty and error states', async () => {
    stubApi({ '/notifications': page([]) });
    mount();
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    stubApi({
      '/notifications': new Response(
        JSON.stringify({ code: 'INTERNAL', message: 'x', requestId: '' }),
        { status: 500 },
      ),
    });
    mount();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});
