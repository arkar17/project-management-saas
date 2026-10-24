import {
  activityDto,
  attachmentDownloadDto,
  attachmentDto,
  attachmentUploadDto,
  confirmAttachmentInput,
  initiateAttachmentInput,
  commentDto,
  commentInput,
  createIssueInput,
  issueDto,
  issueListDto,
  issueListQuery,
  labelDto,
  labelInput,
  moderateCommentInput,
  setIssueLabelsInput,
  updateIssueInput,
  updateLabelInput,
  watchersDto,
} from '@pm/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendDto } from '../../http/respond.js';
import { validateBody } from '../../http/validate.js';
import type { Db } from '../../lib/prisma.js';
import { resolveIssueAccess, resolveProjectAccess } from '../../policy/access.js';
import { currentSession } from '../auth/session.middleware.js';
import type { AttachmentService } from './attachment.service.js';
import type { CommentService } from './comment.service.js';
import type { IssueService } from './issue.service.js';
import type { LabelService } from './label.service.js';

interface Deps {
  db: Db;
  issues: IssueService;
  comments: CommentService;
  labels: LabelService;
  attachments: AttachmentService;
}

const issueBody = z.object({ issue: issueDto });
const userId = (req: Request) => currentSession(req).userId;

/** Mounted at /api/v1 behind requireSession('APP') + requireVerifiedEmail. */
export function issueRouter({ db, issues, comments, labels, attachments }: Deps) {
  const router = Router();
  const project = (req: Request) => resolveProjectAccess(db, userId(req), String(req.params.pid));
  const issue = (req: Request) => resolveIssueAccess(db, userId(req), String(req.params.iid));

  // Project-scoped collections.
  router.get('/projects/:pid/issues', async (req, res) => {
    sendDto(
      res,
      issueListDto,
      await issues.list(await project(req), issueListQuery.parse(req.query)),
    );
  });
  router.post('/projects/:pid/issues', validateBody(createIssueInput), async (req, res) => {
    sendDto(res, issueBody, { issue: await issues.create(await project(req), req.body) }, 201);
  });
  router.get('/projects/:pid/labels', async (req, res) => {
    sendDto(res, z.object({ labels: z.array(labelDto) }), {
      labels: await labels.list(await project(req)),
    });
  });
  router.post('/projects/:pid/labels', validateBody(labelInput), async (req, res) => {
    sendDto(
      res,
      z.object({ label: labelDto }),
      { label: await labels.create(await project(req), req.body) },
      201,
    );
  });

  // Labels by id.
  router.patch('/labels/:lid', validateBody(updateLabelInput), async (req, res) => {
    sendDto(res, z.object({ label: labelDto }), {
      label: await labels.update(userId(req), String(req.params.lid), req.body),
    });
  });
  router.delete('/labels/:lid', async (req, res) => {
    await labels.remove(userId(req), String(req.params.lid));
    res.status(204).end();
  });

  // Issues by id.
  router.get('/issues/:iid', async (req, res) => {
    sendDto(res, issueBody, { issue: await issues.get(await issue(req)) });
  });
  router.patch('/issues/:iid', validateBody(updateIssueInput), async (req, res) => {
    sendDto(res, issueBody, { issue: await issues.update(await issue(req), req.body) });
  });
  router.delete('/issues/:iid', async (req, res) => {
    await issues.softDelete(await issue(req));
    res.status(204).end();
  });
  router.post('/issues/:iid/restore', async (req, res) => {
    sendDto(res, issueBody, { issue: await issues.restore(await issue(req)) });
  });
  router.put('/issues/:iid/labels', validateBody(setIssueLabelsInput), async (req, res) => {
    sendDto(res, issueBody, { issue: await issues.setLabels(await issue(req), req.body.labelIds) });
  });
  router.get('/issues/:iid/children', async (req, res) => {
    sendDto(res, z.object({ issues: z.array(issueDto) }), {
      issues: await issues.children(await issue(req)),
    });
  });
  router.get('/issues/:iid/activity', async (req, res) => {
    sendDto(res, z.object({ activity: z.array(activityDto) }), {
      activity: await issues.activity(await issue(req)),
    });
  });
  router.get('/issues/:iid/watchers', async (req, res) => {
    sendDto(res, watchersDto, await issues.watchers(await issue(req)));
  });
  router.post('/issues/:iid/watch', async (req, res) => {
    const a = await issue(req);
    await issues.setWatching(a, true);
    sendDto(res, watchersDto, await issues.watchers(a));
  });
  router.delete('/issues/:iid/watch', async (req, res) => {
    const a = await issue(req);
    await issues.setWatching(a, false);
    sendDto(res, watchersDto, await issues.watchers(a));
  });

  // Comments.
  router.get('/issues/:iid/comments', async (req, res) => {
    sendDto(res, z.object({ comments: z.array(commentDto) }), {
      comments: await comments.list(await issue(req)),
    });
  });
  router.post('/issues/:iid/comments', validateBody(commentInput), async (req, res) => {
    sendDto(
      res,
      z.object({ comment: commentDto }),
      { comment: await comments.create(await issue(req), req.body.body) },
      201,
    );
  });
  router.patch('/comments/:cid', validateBody(commentInput), async (req, res) => {
    sendDto(res, z.object({ comment: commentDto }), {
      comment: await comments.edit(userId(req), String(req.params.cid), req.body.body),
    });
  });
  router.delete('/comments/:cid', async (req, res) => {
    await comments.deleteOwn(userId(req), String(req.params.cid));
    res.status(204).end();
  });
  router.post('/comments/:cid/moderate', validateBody(moderateCommentInput), async (req, res) => {
    await comments.moderate(userId(req), String(req.params.cid), req.body.reason);
    res.status(204).end();
  });

  // Attachments (FR-ISS-006, ADR-004): initiate → client PUTs to storage → confirm.
  router.get('/issues/:iid/attachments', async (req, res) => {
    sendDto(res, z.object({ attachments: z.array(attachmentDto) }), {
      attachments: await attachments.list(await issue(req)),
    });
  });
  router.post(
    '/issues/:iid/attachments',
    validateBody(initiateAttachmentInput),
    async (req, res) => {
      sendDto(
        res,
        z.object({ upload: attachmentUploadDto }),
        { upload: await attachments.initiate(await issue(req), req.body) },
        201,
      );
    },
  );
  router.post(
    '/issues/:iid/attachments/confirm',
    validateBody(confirmAttachmentInput),
    async (req, res) => {
      sendDto(
        res,
        z.object({ attachment: attachmentDto }),
        { attachment: await attachments.confirm(await issue(req), req.body.uploadId) },
        201,
      );
    },
  );
  router.get('/attachments/:aid/download', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendDto(res, z.object({ download: attachmentDownloadDto }), {
      download: await attachments.download(userId(req), String(req.params.aid)),
    });
  });

  return router;
}
