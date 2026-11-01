import { Router } from 'express';
import type { Db } from '../../lib/prisma.js';

export function healthRouter(db: Db) {
  const router = Router();
  // Liveness: process is up; never touches dependencies.
  router.get('/', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // Readiness: database reachable.
  router.get('/ready', async (req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });
  return router;
}
