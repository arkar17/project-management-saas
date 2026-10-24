import { z } from 'zod';

/** FR-ISS-006 / ADR-004: 10 MB per file. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Signed upload and download URLs live at most five minutes (ADR-004). */
export const ATTACHMENT_URL_TTL_SECONDS = 300;

/** ADR-004 allow-list: extension → the one MIME type accepted for it. */
export const ATTACHMENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  zip: 'application/zip',
} as const;
export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/zip',
] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/** Accept attribute for file inputs. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

export function attachmentExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** The canonical MIME type for a filename, or null when its extension is not allowed. */
export function attachmentMimeFor(filename: string): AttachmentMimeType | null {
  const ext = attachmentExtension(filename);
  return Object.hasOwn(ATTACHMENT_TYPES, ext)
    ? ATTACHMENT_TYPES[ext as keyof typeof ATTACHMENT_TYPES]
    : null;
}

/** Shared pre-flight check (web shows it before upload; API enforces it). */
export function attachmentFileError(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): string | null {
  const expected = attachmentMimeFor(filename);
  if (!expected) return 'This file type is not allowed';
  if (mimeType !== expected) return 'File type does not match its extension';
  if (sizeBytes <= 0) return 'File is empty';
  if (sizeBytes > ATTACHMENT_MAX_BYTES) return 'File is larger than 10 MB';
  return null;
}

// Names are display-only metadata; storage keys never derive from them (ADR-004).
// eslint-disable-next-line no-control-regex
const unsafeName = /[\u0000-\u001f\u007f/\\]/;

export const initiateAttachmentInput = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((n) => !unsafeName.test(n), 'Filename contains invalid characters'),
    mimeType: z.enum(ATTACHMENT_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
  })
  .superRefine((v, ctx) => {
    const error = attachmentFileError(v.filename, v.sizeBytes, v.mimeType);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mimeType'], message: error });
  });
export type InitiateAttachmentInput = z.infer<typeof initiateAttachmentInput>;

export const confirmAttachmentInput = z.object({ uploadId: z.string().uuid() });

export const attachmentUploadDto = z.object({
  uploadId: z.string().uuid(),
  url: z.string().url(),
  method: z.literal('PUT'),
  /** Headers the client must send verbatim; they are part of the signature. */
  headers: z.record(z.string()),
  expiresAt: z.string(),
});
export type AttachmentUploadDto = z.infer<typeof attachmentUploadDto>;

export const attachmentDto = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  uploader: z.object({ id: z.string().uuid(), name: z.string() }),
  createdAt: z.string(),
});
export type AttachmentDto = z.infer<typeof attachmentDto>;

export const attachmentDownloadDto = z.object({ url: z.string().url(), expiresAt: z.string() });
export type AttachmentDownloadDto = z.infer<typeof attachmentDownloadDto>;
