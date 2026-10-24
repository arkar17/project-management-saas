import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createS3Storage } from '../src/lib/storage.js';

/**
 * Disposable in-process S3 stand-in for integration tests. Unlike the common local emulators it
 * verifies SigV4 signatures (header and presigned-query) and presigned expiry, so tests can
 * prove that tampered, expired and anonymous requests are refused. Path-style, one bucket.
 */

interface StoredObject {
  body: Buffer;
  contentType: string;
  metadata: Record<string, string>;
}

export const TEST_BUCKET = 'pm-attachments-test';
const ACCESS_KEY = 'test-access-key';
const SECRET_KEY = 'test-secret-key';
const REGION = 'us-east-1';

const hmac = (key: Buffer | string, data: string) =>
  createHmac('sha256', key).update(data).digest();
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function amzDateToMs(d: string): number {
  return Date.UTC(
    +d.slice(0, 4),
    +d.slice(4, 6) - 1,
    +d.slice(6, 8),
    +d.slice(9, 11),
    +d.slice(11, 13),
    +d.slice(13, 15),
  );
}

type Verdict = 'ok' | 'anonymous' | 'expired' | 'bad-signature';

function verify(req: IncomingMessage, url: URL): Verdict {
  const q = url.searchParams;
  const auth = req.headers.authorization;
  let signedHeaders: string;
  let credential: string;
  let signature: string;
  let amzDate: string;
  let payloadHash: string;

  if (q.has('X-Amz-Signature')) {
    signedHeaders = q.get('X-Amz-SignedHeaders') ?? '';
    credential = q.get('X-Amz-Credential') ?? '';
    signature = q.get('X-Amz-Signature') ?? '';
    amzDate = q.get('X-Amz-Date') ?? '';
    payloadHash = q.get('X-Amz-Content-Sha256') ?? 'UNSIGNED-PAYLOAD';
    const expires = Number(q.get('X-Amz-Expires'));
    if (!Number.isFinite(expires) || Date.now() > amzDateToMs(amzDate) + expires * 1000) {
      return 'expired';
    }
  } else if (auth?.startsWith('AWS4-HMAC-SHA256 ')) {
    const parts = Object.fromEntries(
      auth
        .slice(17)
        .split(/,\s*/)
        .map((p) => p.split('=') as [string, string]),
    );
    signedHeaders = parts.SignedHeaders ?? '';
    credential = parts.Credential ?? '';
    signature = parts.Signature ?? '';
    amzDate = String(req.headers['x-amz-date'] ?? '');
    payloadHash = String(req.headers['x-amz-content-sha256'] ?? 'UNSIGNED-PAYLOAD');
  } else {
    return 'anonymous';
  }

  const [accessKey, date, region, service] = credential.split('/');
  if (accessKey !== ACCESS_KEY || region !== REGION || service !== 's3') return 'bad-signature';

  const query = [...q.entries()]
    .filter(([k]) => k !== 'X-Amz-Signature')
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const headers = signedHeaders
    .split(';')
    .map(
      (h) =>
        `${h}:${String(req.headers[h] ?? '')
          .trim()
          .replace(/\s+/g, ' ')}\n`,
    )
    .join('');
  const canonical = [req.method, url.pathname, query, headers, signedHeaders, payloadHash].join(
    '\n',
  );
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, date!), region), 's3'), 'aws4_request');
  return hmac(key, toSign).toString('hex') === signature ? 'ok' : 'bad-signature';
}

function xmlError(res: ServerResponse, status: number, code: string) {
  res.writeHead(status, { 'Content-Type': 'application/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`);
}

export interface S3TestServer {
  endpoint: string;
  objects: Map<string, StoredObject>;
  storage: ReturnType<typeof createS3Storage>;
  close(): Promise<void>;
}

export async function startS3TestServer(): Promise<S3TestServer> {
  const objects = new Map<string, StoredObject>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const verdict = verify(req, url);
      if (verdict === 'expired') return xmlError(res, 403, 'AccessDenied');
      if (verdict !== 'ok')
        return xmlError(
          res,
          403,
          verdict === 'anonymous' ? 'AccessDenied' : 'SignatureDoesNotMatch',
        );

      const [, bucket, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      if (bucket !== TEST_BUCKET || !key) return xmlError(res, 404, 'NoSuchBucket');
      const obj = objects.get(key);

      switch (req.method) {
        case 'PUT': {
          const metadata: Record<string, string> = {};
          for (const [h, v] of Object.entries(req.headers)) {
            if (h.startsWith('x-amz-meta-')) metadata[h.slice(11)] = String(v);
          }
          objects.set(key, {
            body: Buffer.concat(chunks),
            contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
            metadata,
          });
          res.writeHead(200, { ETag: '"test"' });
          return res.end();
        }
        case 'HEAD':
        case 'GET': {
          if (!obj) {
            res.writeHead(404, { 'Content-Type': 'application/xml' });
            return res.end(
              req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>',
            );
          }
          let body = obj.body;
          let status = 200;
          const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''));
          if (range) {
            body = obj.body.subarray(+range[1]!, +range[2]! + 1);
            status = 206;
          }
          const headers: Record<string, string> = {
            'Content-Type': url.searchParams.get('response-content-type') ?? obj.contentType,
            'Content-Length': String(req.method === 'HEAD' ? obj.body.length : body.length),
            ETag: '"test"',
          };
          const disposition = url.searchParams.get('response-content-disposition');
          if (disposition) headers['Content-Disposition'] = disposition;
          for (const [k, v] of Object.entries(obj.metadata)) headers[`x-amz-meta-${k}`] = v;
          res.writeHead(status, headers);
          return res.end(req.method === 'HEAD' ? undefined : body);
        }
        case 'DELETE':
          objects.delete(key);
          res.writeHead(204);
          return res.end();
        default:
          return xmlError(res, 405, 'MethodNotAllowed');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const storage = createS3Storage({
    bucket: TEST_BUCKET,
    region: REGION,
    endpoint,
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    forcePathStyle: true,
  });
  return {
    endpoint,
    objects,
    storage,
    close: () =>
      new Promise((resolve) => {
        storage.client.destroy();
        server.close(() => resolve());
      }),
  };
}
