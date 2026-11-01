import type { NotificationDto } from '@pm/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { useNotifications, useReadAll, useSetRead } from '../../lib/notifications';

const FIELD_TEXT: Record<string, string> = {
  status: 'status',
  assigneeId: 'assignee',
};

export function describeNotification(n: NotificationDto): string {
  const who = n.actor?.name ?? 'Someone';
  const what = n.issue ? `${n.issue.key} · ${n.issue.title}` : '';
  switch (n.type) {
    case 'ASSIGNED':
      return `${who} assigned you ${what}`;
    case 'MENTIONED':
      return `${who} mentioned you on ${what}`;
    case 'INVITE_ACCEPTED':
      return `${who} accepted your invitation`;
    case 'WATCHED_ISSUE_UPDATED':
      return n.fields.includes('comment')
        ? `${who} commented on ${what}`
        : `${who} changed the ${n.fields.map((f) => FIELD_TEXT[f] ?? f).join(' and ')} of ${what}`;
  }
}

/** Where a notification leads; links are only to resources the API just authorized. */
export function notificationHref(n: NotificationDto): string {
  if (n.issue && n.projectId) {
    return `/workspaces/${n.workspaceId}/projects/${n.projectId}/issues/${n.issue.id}`;
  }
  return `/workspaces/${n.workspaceId}/members`;
}

const linkBtn = 'rounded px-2 py-1 text-xs font-medium text-primary hover:bg-indigo-50';

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const list = useNotifications(unreadOnly, page);
  const setRead = useSetRead();
  const readAll = useReadAll();
  const navigate = useNavigate();
  const error = setRead.error ?? readAll.error;

  function open(n: NotificationDto) {
    if (!n.readAt) setRead.mutate({ id: n.id, read: true });
    navigate(notificationHref(n));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.target.checked);
              setPage(1);
            }}
          />
          Unread only
        </label>
        <Button
          className="h-9 w-auto bg-white text-slate-900 ring-1 ring-border"
          disabled={readAll.isPending}
          onClick={() => readAll.mutate(undefined)}
        >
          Mark all read
        </Button>
      </div>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : list.data.notifications.length === 0 ? (
        <EmptyState title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}>
          <p>Assignments, mentions and updates to issues you watch appear here.</p>
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-xl border border-border bg-white">
            {list.data.notifications.map((n) => (
              <li
                key={n.id}
                className={`flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3 ${n.readAt ? '' : 'bg-indigo-50/50'}`}
              >
                <Link
                  to={notificationHref(n)}
                  onClick={(e) => {
                    e.preventDefault();
                    open(n);
                  }}
                  className="min-w-0 flex-1 text-sm hover:text-primary"
                >
                  {!n.readAt && <span className="sr-only">Unread: </span>}
                  <span className={n.readAt ? '' : 'font-medium'}>{describeNotification(n)}</span>
                  <time className="block text-xs text-muted" dateTime={n.createdAt}>
                    {new Date(n.createdAt).toLocaleString()}
                  </time>
                </Link>
                <button
                  type="button"
                  className={`${linkBtn} self-start sm:self-auto`}
                  onClick={() => setRead.mutate({ id: n.id, read: !n.readAt })}
                >
                  {n.readAt ? 'Mark unread' : 'Mark read'}
                </button>
              </li>
            ))}
          </ul>
          {list.data.total > list.data.pageSize && (
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className={linkBtn}
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Newer
              </button>
              <span className="text-muted">
                Page {page} of {Math.ceil(list.data.total / list.data.pageSize)}
              </span>
              <button
                type="button"
                className={linkBtn}
                disabled={page * list.data.pageSize >= list.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Older →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
