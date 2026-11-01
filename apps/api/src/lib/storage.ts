import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ATTACHMENT_URL_TTL_SECONDS } from '@pm/shared';

/**
 * Private object storage behind the ADR-004 adapter. Objects are never public: every read or
 * write goes through a short-lived signed URL issued after the API has authorized the caller.
 */
export interface SignedRequest {
  url: string;
  /** Headers the client must send unchanged (they are covered by the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
  metadata: Record<string, string>;
}

export interface PutOptions {
  contentType: string;
  contentLength: number;
  metadata: Record<string, string>;
}

export interface GetOptions {
  filename: string;
  contentType: string;
}

export interface ObjectStorage {
  putSignedUrl(key: string, opts: PutOptions, ttlSeconds?: number): Promise<SignedRequest>;
  getSignedUrl(key: string, opts: GetOptions, ttlSeconds?: number): Promise<SignedRequest>;
  /** null when the object does not exist (failed or never-started upload). */
  head(key: string): Promise<ObjectHead | null>;
  /** First `bytes` bytes of the object, for content sniffing. */
  readStart(key: string, bytes: number): Promise<Uint8Array>;
  /** Removes rejected uploads; confirmed attachments are never hard-deleted (ADR-014). */
  delete(key: string): Promise<void>;
}

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Callers may shorten but never extend the five-minute window. */
function ttl(requested?: number): number {
  return Math.max(1, Math.min(requested ?? ATTACHMENT_URL_TTL_SECONDS, ATTACHMENT_URL_TTL_SECONDS));
}

/** RFC 6266 header; the ASCII fallback strips quotes and non-printable characters. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof S3ServiceException &&
    (err.$metadata.httpStatusCode === 404 || err.name === 'NotFound' || err.name === 'NoSuchKey')
  );
}

export function createS3Storage(config: S3StorageConfig): ObjectStorage & { client: S3Client } {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    // Presigned PUTs have no body at signing time; a checksum would be of the empty payload.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;

  return {
    client,

    async putSignedUrl(key, opts, ttlSeconds) {
      const expiresIn = ttl(ttlSeconds);
      const metaHeaders = Object.fromEntries(
        Object.entries(opts.metadata).map(([k, v]) => [`x-amz-meta-${k.toLowerCase()}`, v]),
      );
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: opts.contentType,
          ContentLength: opts.contentLength,
          Metadata: opts.metadata,
        }),
        {
          expiresIn,
          // Sign type, length and metadata as headers so the client cannot change them.
          signableHeaders: new Set(['content-type', 'content-length']),
          unhoistableHeaders: new Set(Object.keys(metaHeaders)),
        },
      );
      return {
        url,
        headers: { 'Content-Type': opts.contentType, ...metaHeaders },
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
    },

    async getSignedUrl(key, opts, ttlSeconds) {
      const expiresIn = ttl(ttlSeconds);
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(opts.filename),
          ResponseContentType: opts.contentType,
        }),
        { expiresIn },
      );
      return { url, headers: {}, expiresAt: new Date(Date.now() + expiresIn * 1000) };
    },

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          sizeBytes: res.ContentLength ?? 0,
          contentType: res.ContentType ?? null,
          metadata: res.Metadata ?? {},
        };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async readStart(key, bytes) {
      const res = await client.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
      );
      const body = res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
      return body.subarray(0, bytes);
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
