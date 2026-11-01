import { notificationListDto, notificationListQuery, unreadCountDto } from '@pm/shared';
import { Router, type Request } from 'express';
import { sendDto } from '../../http/respond.js';
import { currentSession } from '../auth/session.middleware.js';
import type { NotificationService } from './notification.service.js';

const userId = (req: Request) => currentSession(req).userId;

/** FR-NTF-002. Mounted at /api/v1/notifications behind requireSession('APP') + verified email. */
export function notificationRouter(notifications: NotificationService) {
  const router = Router();
  router.get('/', async (req, res) => {
    sendDto(
      res,
      notificationListDto,
      await notifications.list(userId(req), notificationListQuery.parse(req.query)),
    );
  });
  router.get('/unread-count', async (req, res) => {
    sendDto(res, unreadCountDto, { unread: await notifications.unreadCount(userId(req)) });
  });
  router.patch('/:nid/read', async (req, res) => {
    await notifications.markRead(userId(req), String(req.params.nid));
    res.status(204).end();
  });
  router.patch('/:nid/unread', async (req, res) => {
    await notifications.markUnread(userId(req), String(req.params.nid));
    res.status(204).end();
  });
  router.post('/read-all', async (req, res) => {
    await notifications.markAllRead(userId(req));
    res.status(204).end();
  });
  return router;
}
