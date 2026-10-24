/**
 * Real-S3 compatibility check for the ADR-004 adapter (GAP-11). Runs against the bucket in
 * .env (local MinIO from docker-compose) and exercises exactly what attachments rely on:
 * signed PUT with signed type/length/metadata, HEAD, ranged read, signed GET with
 * Content-Disposition, refusal of tampered, anonymous and expired requests, and delete.
 *
 *   npx tsx --env-file=../../.env scripts/verify-s3.ts
 *
 * Writes and removes one object under ws/verify/att/. Exits non-zero on the first failure.
 */
import { randomUUID } from 'node:crypto';
import { createS3Storage } from '../src/lib/storage.js';

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

const storage = createS3Storage({
  bucket: need('S3_BUCKET'),
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: need('S3_ACCESS_KEY_ID'),
  secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

let failed = false;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed = true;
}

const key = `ws/verify/att/${randomUUID()}`;
const body = Buffer.from('%PDF-1.7\nverify\n');
const meta = {
  issue: 'verify',
  uploader: 'verify',
  size: String(body.length),
  filename: 'r%C3%A9sum%C3%A9.pdf',
};

try {
  const put = await storage.putSignedUrl(key, {
    contentType: 'application/pdf',
    contentLength: body.length,
    metadata: meta,
  });
  check('signed PUT valid for 300 s', new URL(put.url).searchParams.get('X-Amz-Expires') === '300');

  const tampered = await fetch(put.url, {
    method: 'PUT',
    headers: { ...put.headers, 'Content-Type': 'text/html' },
    body,
  });
  check(
    'PUT with altered Content-Type refused',
    tampered.status === 403,
    `HTTP ${tampered.status}`,
  );
  const longer = await fetch(put.url, {
    method: 'PUT',
    headers: put.headers,
    body: Buffer.concat([body, Buffer.from('extra')]),
  });
  check('PUT larger than signed length refused', longer.status >= 400, `HTTP ${longer.status}`);

  const ok = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
  check('signed PUT accepted', ok.status === 200, `HTTP ${ok.status}`);

  const head = await storage.head(key);
  check(
    'HEAD size/type',
    head?.sizeBytes === body.length && head.contentType === 'application/pdf',
  );
  check(
    'HEAD metadata round-trips',
    head?.metadata.issue === 'verify' &&
      head.metadata.size === meta.size &&
      head.metadata.filename === meta.filename,
    JSON.stringify(head?.metadata),
  );
  const start = Buffer.from(await storage.readStart(key, 5));
  check('ranged read returns magic bytes', start.toString() === '%PDF-');
  check('HEAD of missing key is null', (await storage.head(`${key}-missing`)) === null);

  const get = await storage.getSignedUrl(key, {
    filename: 'résumé.pdf',
    contentType: 'application/pdf',
  });
  const file = await fetch(get.url);
  check(
    'signed GET returns the bytes',
    file.status === 200 && Buffer.from(await file.arrayBuffer()).equals(body),
  );
  check(
    'GET forces attachment disposition',
    (file.headers.get('content-disposition') ?? '').startsWith('attachment;'),
    file.headers.get('content-disposition') ?? 'none',
  );

  const anon = await fetch(get.url.split('?')[0]!);
  check('anonymous GET refused (private bucket)', anon.status === 403, `HTTP ${anon.status}`);

  const short = await storage.getSignedUrl(
    key,
    { filename: 'x.pdf', contentType: 'application/pdf' },
    1,
  );
  await new Promise((r) => setTimeout(r, 2500));
  const expired = await fetch(short.url);
  check('expired signed GET refused', expired.status === 403, `HTTP ${expired.status}`);
} finally {
  await storage.delete(key);
  check('delete removes the object', (await storage.head(key)) === null);
  storage.client.destroy();
}
process.exit(failed ? 1 : 0);
