import type { NotificationListDto } from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (unread: boolean, page: number) => ['notifications', 'list', unread, page] as const,
  count: ['notifications', 'count'] as const,
};

export const useNotifications = (unread: boolean, page: number) =>
  useQuery({
    queryKey: notificationKeys.list(unread, page),
    queryFn: () =>
      api<NotificationListDto>(
        `/notifications?page=${page}&pageSize=25${unread ? '&unread=true' : ''}`,
      ),
    placeholderData: (prev) => prev,
  });

/** Badge count; polled because delivery happens asynchronously in apps/worker. */
export const useUnreadCount = (enabled = true) =>
  useQuery({
    queryKey: notificationKeys.count,
    queryFn: async () => (await api<{ unread: number }>('/notifications/unread-count')).unread,
    refetchInterval: 30_000,
    enabled,
  });

function useNotificationMutation<T>(fn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export const useSetRead = () =>
  useNotificationMutation(({ id, read }: { id: string; read: boolean }) =>
    api(`/notifications/${id}/${read ? 'read' : 'unread'}`, { method: 'PATCH' }),
  );
export const useReadAll = () =>
  useNotificationMutation(() => api('/notifications/read-all', { method: 'POST' }));
