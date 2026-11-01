import {
  ATTACHMENT_MAX_BYTES,
  ErrorCode,
  attachmentMimeFor,
  type AttachmentDownloadDto,
  type AttachmentDto,
  type AttachmentUploadDto,
  type InitiateAttachmentInput,
} from '@pm/shared';
import { Prisma, type Attachment } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import type { ObjectStorage } from '../../lib/storage.js';
import {
  assertCan,
  assertId,
  assertWritable,
  resolveIssueAccess,
  type IssueAccess,
} from '../../policy/access.js';
import { SNIFF_BYTES, matchesSignature } from './file-signature.js';

type Row = Attachment & { uploader: { id: string; name: string } };
const include = { uploader: { select: { id: true, name: true } } } as const;

function toDto(a: Row): AttachmentDto {
  return {
    id: a.id,
    filename: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploader: a.uploader,
    createdAt: a.createdAt.toISOString(),
  };
}

export type FileRejection =
  'UPLOAD_MISSING' | 'TYPE_NOT_ALLOWED' | 'SIZE_MISMATCH' | 'TOO_LARGE' | 'SIGNATURE_MISMATCH';

const rejected = (reason: FileRejection, message: string) =>
  new AppError(422, ErrorCode.FILE_REJECTED, message, { reason });

/** ADR-004: random, workspace-scoped key; never derived from the user's file name. */
export const attachmentKey = (workspaceId: string, uploadId: string) =>
  `ws/${workspaceId}/att/${uploadId}`;

export function createAttachmentService(db: Db, storage: ObjectStorage) {
  /** Uploads need a writable project, a live issue and the attach capability. */
  async function assertCanUpload(access: IssueAccess) {
    assertWritable(access);
    assertCan(access, 'commentAndAttach');
    const issue = await db.issue.findUnique({
      where: { id: access.issueId },
      select: { deletedAt: true },
    });
    if (issue?.deletedAt) throw conflict(ErrorCode.CONFLICT, 'Issue is deleted');
  }

  return {
    async list(access: IssueAccess): Promise<AttachmentDto[]> {
      const rows = await db.attachment.findMany({
        where: { issueId: access.issueId },
        include,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(toDto);
    },

    /** Step 1: validate the declared file and hand out a 5-minute signed PUT. */
    async initiate(
      access: IssueAccess,
      input: InitiateAttachmentInput,
    ): Promise<AttachmentUploadDto> {
      await assertCanUpload(access);
      const uploadId = randomUUID();
      const signed = await storage.putSignedUrl(attachmentKey(access.workspaceId, uploadId), {
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        // Bound into the signature, then re-checked on confirm.
        metadata: {
          issue: access.issueId,
          uploader: access.userId,
          size: String(input.sizeBytes),
          filename: encodeURIComponent(input.filename),
        },
      });
      return {
        uploadId,
        url: signed.url,
        method: 'PUT',
        headers: signed.headers,
        expiresAt: signed.expiresAt.toISOString(),
      };
    },

    /**
     * Step 2: the object must exist, belong to this caller and issue, and pass size, type and
     * signature checks. Only then is an Attachment row written; rejected objects are removed.
     */
    async confirm(access: IssueAccess, uploadId: string): Promise<AttachmentDto> {
      await assertCanUpload(access);
      const objectKey = attachmentKey(access.workspaceId, assertId(uploadId));

      const existing = await db.attachment.findUnique({ where: { objectKey }, include });
      if (existing) {
        if (existing.issueId !== access.issueId) throw notFound();
        return toDto(existing);
      }

      const head = await storage.head(objectKey);
      if (!head)
        throw rejected('UPLOAD_MISSING', 'Upload not found; it may have failed or expired');
      // Someone else's pending upload is not visible to this caller.
      if (head.metadata.issue !== access.issueId || head.metadata.uploader !== access.userId) {
        throw notFound();
      }

      let filename: string;
      try {
        filename = decodeURIComponent(head.metadata.filename ?? '');
      } catch {
        filename = '';
      }
      const reject = async (reason: FileRejection, message: string) => {
        await storage.delete(objectKey);
        return rejected(reason, message);
      };
      const mimeType = attachmentMimeFor(filename);
      if (!filename || !mimeType || head.contentType !== mimeType) {
        throw await reject('TYPE_NOT_ALLOWED', 'This file type is not allowed');
      }
      if (head.sizeBytes > ATTACHMENT_MAX_BYTES) {
        throw await reject('TOO_LARGE', 'File is larger than 10 MB');
      }
      if (head.metadata.size !== String(head.sizeBytes) || head.sizeBytes === 0) {
        throw await reject('SIZE_MISMATCH', 'Uploaded size does not match the declared size');
      }
      const sample = await storage.readStart(objectKey, SNIFF_BYTES);
      if (!matchesSignature(mimeType, sample, head.sizeBytes > sample.length)) {
        throw await reject('SIGNATURE_MISMATCH', 'File content does not match its type');
      }

      try {
        const row = await db.$transaction(async (tx) => {
          const created = await tx.attachment.create({
            data: {
              issueId: access.issueId,
              uploaderId: access.userId,
              objectKey,
              mimeType,
              sizeBytes: head.sizeBytes,
              originalName: filename,
            },
            include,
          });
          await tx.issueActivity.create({
            data: {
              issueId: access.issueId,
              actorId: access.userId,
              field: 'attachment',
              newValue: filename,
            },
          });
          return created;
        });
        return toDto(row);
      } catch (err) {
        // A concurrent confirm of the same upload already wrote the row.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const row = await db.attachment.findUnique({ where: { objectKey }, include });
          if (row) return toDto(row);
        }
        throw err;
      }
    },

    /** Attachment → Issue → Project → Workspace; a fresh 5-minute signed GET per request. */
    async download(userId: string, attachmentId: string): Promise<AttachmentDownloadDto> {
      const attachment = await db.attachment.findUnique({ where: { id: assertId(attachmentId) } });
      if (!attachment) throw notFound();
      const access = await resolveIssueAccess(db, userId, attachment.issueId);
      // Defence in depth: the key must sit under the caller's resolved workspace.
      if (!attachment.objectKey.startsWith(`ws/${access.workspaceId}/att/`)) throw notFound();
      if (!(await storage.head(attachment.objectKey))) throw notFound();
      const signed = await storage.getSignedUrl(attachment.objectKey, {
        filename: attachment.originalName,
        contentType: attachment.mimeType,
      });
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    },
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
