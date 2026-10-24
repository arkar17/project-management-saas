import { z } from 'zod';

export const NOTIFICATION_TYPES = [
  'ASSIGNED',
  'MENTIONED',
  'INVITE_ACCEPTED',
  'WATCHED_ISSUE_UPDATED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationListQuery = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type NotificationListQuery = z.infer<typeof notificationListQuery>;

/** Rendered at read time from current data; nothing private is copied into the row. */
export const notificationDto = z.object({
  id: z.string().uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  issue: z.object({ id: z.string().uuid(), key: z.string(), title: z.string() }).nullable(),
  actor: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** For WATCHED_ISSUE_UPDATED: changed fields, or ['comment'] for a new comment. */
  fields: z.array(z.string()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationDto>;

export const notificationListDto = z.object({
  notifications: z.array(notificationDto),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type NotificationListDto = z.infer<typeof notificationListDto>;

export const unreadCountDto = z.object({ unread: z.number().int() });
