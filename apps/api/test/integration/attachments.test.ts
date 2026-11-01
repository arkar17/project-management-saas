import { ATTACHMENT_MAX_BYTES } from '@pm/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, csrf } from '../helpers.js';
import { startS3TestServer, type S3TestServer } from '../s3-test-server.js';
import { createIssue, createUser, createWorkspace, db, signIn } from './setup.js';

const api = '/api/v1';
const as = (cookie: string) => csrf([cookie]);

let s3: S3TestServer;
beforeAll(async () => {
  s3 = await startS3TestServer();
});
afterAll(() => s3.close());
afterEach(() => {
  vi.useRealTimers();
  s3.objects.clear();
});

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : Buffer.from(p))));

/** Minimal byte samples whose leading signature matches each ADR-004 type. */
const SAMPLES: Record<string, { mimeType: string; body: Buffer }> = {
  'shot.png': {
    mimeType: 'image/png',
    body: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR'),
  },
  'photo.jpg': { mimeType: 'image/jpeg', body: bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF') },
  'photo.jpeg': { mimeType: 'image/jpeg', body: bytes([0xff, 0xd8, 0xff, 0xdb], 'data') },
  'anim.gif': { mimeType: 'image/gif', body: bytes('GIF89a', [1, 0, 1, 0]) },
  'pic.webp': { mimeType: 'image/webp', body: bytes('RIFF', [4, 0, 0, 0], 'WEBPVP8 ') },
  'spec.pdf': { mimeType: 'application/pdf', body: bytes('%PDF-1.7\n%âãÏÓ\n') },
  'notes.txt': { mimeType: 'text/plain', body: bytes('héllo wörld\r\n\tindent') },
  'data.csv': { mimeType: 'text/csv', body: bytes('a,b\n1,2\n') },
  'README.md': { mimeType: 'text/markdown', body: bytes('# Title\n\n- item\n') },
  'bundle.zip': { mimeType: 'application/zip', body: bytes([0x50, 0x4b, 0x03, 0x04], 'rest') },
};

/** Owner, a PM, a project Member, a second Member, a workspace member without project access. */
async function world() {
  const { app } = buildApp({ db, storage: s3.storage });
  const u = {
    owner: await createUser('owner@a.test'),
    pm: await createUser('pm@a.test'),
    member: await createUser('member@a.test'),
    member2: await createUser('member2@a.test'),
    outsider: await createUser('outsider@a.test'),
    rival: await createUser('rival@a.test'),
  };
  const { workspace, project } = await createWorkspace('attach-co', u.owner.id);
  await db.workspaceMember.createMany({
    data: [u.pm, u.member, u.member2, u.outsider].map((x) => ({
      workspaceId: workspace.id,
      userId: x.id,
      role: 'MEMBER' as const,
    })),
  });
  await db.projectMember.createMany({
    data: [
      { projectId: project.id, userId: u.pm.id, role: 'PROJECT_MANAGER' as const },
      { projectId: project.id, userId: u.member.id, role: 'MEMBER' as const },
      { projectId: project.id, userId: u.member2.id, role: 'MEMBER' as const },
    ],
  });
  const rival = await createWorkspace('rival-co', u.rival.id);
  const issue = await createIssue(workspace.id, project.id, u.pm.id);
  const other = await createIssue(workspace.id, project.id, u.pm.id);
  const c = {
    owner: await signIn(app, u.owner.email),
    pm: await signIn(app, u.pm.email),
    member: await signIn(app, u.member.email),
    member2: await signIn(app, u.member2.email),
    outsider: await signIn(app, u.outsider.email),
    rival: await signIn(app, u.rival.email),
  };

  const initiate = (cookie: string, iid: string, body: Record<string, unknown>) =>
    request(app).post(`${api}/issues/${iid}/attachments`).set(as(cookie)).send(body);
  const confirm = (cookie: string, iid: string, uploadId: string) =>
    request(app)
      .post(`${api}/issues/${iid}/attachments/confirm`)
      .set(as(cookie))
      .send({ uploadId });
  const put = (upload: { url: string; headers: Record<string, string> }, body: Buffer) =>
    fetch(upload.url, { method: 'PUT', headers: upload.headers, body });
  const list = (cookie: string, iid: string) =>
    request(app).get(`${api}/issues/${iid}/attachments`).set(as(cookie));
  const download = (cookie: string, aid: string) =>
    request(app).get(`${api}/attachments/${aid}/download`).set(as(cookie));

  /** Full happy path: initiate → signed PUT → confirm. */
  async function upload(
    cookie: string,
    iid: string,
    filename: string,
    body: Buffer,
    mimeType: string,
  ) {
    const init = await initiate(cookie, iid, { filename, mimeType, sizeBytes: body.length });
    expect(init.status).toBe(201);
    expect((await put(init.body.upload, body)).status).toBe(200);
    return {
      uploadId: init.body.upload.uploadId as string,
      res: await confirm(cookie, iid, init.body.upload.uploadId),
    };
  }

  return {
    app,
    wid: workspace.id,
    pid: project.id,
    rival,
    issue,
    other,
    u,
    c,
    initiate,
    confirm,
    put,
    list,
    download,
    upload,
  };
}

describe('FR-ISS-006 attachments', () => {
  it('TC-ISS-006-1 accepts every ADR-004 type and records uploader, name, size, type, date', async () => {
    const w = await world();
    for (const [filename, { mimeType, body }] of Object.entries(SAMPLES)) {
      const { res } = await w.upload(w.c.member, w.issue.id, filename, body, mimeType);
      expect(res.status, filename).toBe(201);
      expect(res.body.attachment).toMatchObject({
        filename,
        mimeType,
        sizeBytes: body.length,
        uploader: { id: w.u.member.id, name: 'member' },
      });
    }
    const rows = await db.attachment.findMany();
    expect(rows).toHaveLength(Object.keys(SAMPLES).length);
    for (const row of rows) {
      // Random key under the workspace; never derived from the user's file name.
      expect(row.objectKey).toMatch(new RegExp(`^ws/${w.wid}/att/[0-9a-f-]{36}$`));
      expect(row.objectKey).not.toContain(row.originalName);
      expect(row.uploaderId).toBe(w.u.member.id);
      expect(row.createdAt).toBeInstanceOf(Date);
    }
    const listed = await w.list(w.c.pm, w.issue.id);
    expect(listed.status).toBe(200);
    expect(listed.body.attachments).toHaveLength(rows.length);
    expect(listed.body.attachments[0]).not.toHaveProperty('objectKey');
    expect(
      await db.issueActivity.count({ where: { issueId: w.issue.id, field: 'attachment' } }),
    ).toBe(rows.length);
  });

  it('TC-ISS-006-1 rejects files over 10 MB, disallowed types and extension/MIME mismatches with 422', async () => {
    const w = await world();
    const cases = [
      { filename: 'big.pdf', mimeType: 'application/pdf', sizeBytes: ATTACHMENT_MAX_BYTES + 1 },
      { filename: 'run.exe', mimeType: 'application/zip', sizeBytes: 10 },
      { filename: 'page.html', mimeType: 'text/html', sizeBytes: 10 },
      { filename: 'logo.svg', mimeType: 'image/svg+xml', sizeBytes: 10 },
      { filename: 'shot.png', mimeType: 'application/pdf', sizeBytes: 10 },
      { filename: 'noext', mimeType: 'text/plain', sizeBytes: 10 },
      { filename: '../../etc/passwd.txt', mimeType: 'text/plain', sizeBytes: 10 },
      { filename: 'empty.txt', mimeType: 'text/plain', sizeBytes: 0 },
    ];
    for (const body of cases) {
      const res = await w.initiate(w.c.member, w.issue.id, body);
      expect(res.status, body.filename).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    // Exactly 10 MB is allowed.
    const ok = await w.initiate(w.c.member, w.issue.id, {
      filename: 'max.pdf',
      mimeType: 'application/pdf',
      sizeBytes: ATTACHMENT_MAX_BYTES,
    });
    expect(ok.status).toBe(201);
  });

  it('TC-ISS-006-1 sniffs content: mismatched signatures are rejected and the object removed', async () => {
    const w = await world();
    const spoofs: [string, string, Buffer][] = [
      ['fake.png', 'image/png', bytes('<html><script>alert(1)</script>')],
      ['fake.pdf', 'application/pdf', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      ['fake.jpg', 'image/jpeg', bytes('GIF89a')],
      ['fake.zip', 'application/zip', bytes('MZ\x90\x00 executable')],
      ['binary.txt', 'text/plain', bytes('MZ', [0x00, 0x01, 0x02])],
      ['image.csv', 'text/csv', SAMPLES['shot.png']!.body],
      ['latin1.md', 'text/markdown', bytes([0x23, 0x20, 0xe9, 0xe8, 0x0a])],
    ];
    for (const [filename, mimeType, body] of spoofs) {
      const { uploadId, res } = await w.upload(w.c.member, w.issue.id, filename, body, mimeType);
      expect(res.status, filename).toBe(422);
      expect(res.body).toMatchObject({
        code: 'FILE_REJECTED',
        details: { reason: 'SIGNATURE_MISMATCH' },
      });
      expect(s3.objects.has(`ws/${w.wid}/att/${uploadId}`)).toBe(false);
    }
    expect(await db.attachment.count()).toBe(0);
  });

  it('enforces the signed size and type: a larger or retyped PUT is refused by storage', async () => {
    const w = await world();
    const { body } = SAMPLES['shot.png']!;
    const init = await w.initiate(w.c.member, w.issue.id, {
      filename: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: body.length,
    });
    const upload = init.body.upload;
    expect((await w.put(upload, Buffer.concat([body, Buffer.alloc(10)]))).status).toBe(403);
    const retyped = await fetch(upload.url, {
      method: 'PUT',
      headers: { ...upload.headers, 'Content-Type': 'text/html' },
      body,
    });
    expect(retyped.status).toBe(403);
    expect((await w.confirm(w.c.member, w.issue.id, upload.uploadId)).body.details).toEqual({
      reason: 'UPLOAD_MISSING',
    });
  });

  it('confirm re-checks stored size and type even if an object bypassed the signature', async () => {
    const w = await world();
    const init = async (filename: string, mimeType: string, sizeBytes: number) =>
      (await w.initiate(w.c.member, w.issue.id, { filename, mimeType, sizeBytes })).body.upload
        .uploadId as string;
    const meta = (uploadId: string, filename: string, size: number) => ({
      issue: w.issue.id,
      uploader: w.u.member.id,
      size: String(size),
      filename,
    });

    const big = await init('big.pdf', 'application/pdf', 100);
    const huge = Buffer.concat([bytes('%PDF-'), Buffer.alloc(ATTACHMENT_MAX_BYTES)]);
    s3.objects.set(`ws/${w.wid}/att/${big}`, {
      body: huge,
      contentType: 'application/pdf',
      metadata: meta(big, 'big.pdf', huge.length),
    });
    const tooLarge = await w.confirm(w.c.member, w.issue.id, big);
    expect(tooLarge.status).toBe(422);
    expect(tooLarge.body.details).toEqual({ reason: 'TOO_LARGE' });

    const sized = await init('a.txt', 'text/plain', 3);
    s3.objects.set(`ws/${w.wid}/att/${sized}`, {
      body: bytes('abcdef'),
      contentType: 'text/plain',
      metadata: meta(sized, 'a.txt', 3),
    });
    expect((await w.confirm(w.c.member, w.issue.id, sized)).body.details).toEqual({
      reason: 'SIZE_MISMATCH',
    });

    const typed = await init('b.txt', 'text/plain', 3);
    s3.objects.set(`ws/${w.wid}/att/${typed}`, {
      body: bytes('abc'),
      contentType: 'text/html',
      metadata: meta(typed, 'b.txt', 3),
    });
    expect((await w.confirm(w.c.member, w.issue.id, typed)).body.details).toEqual({
      reason: 'TYPE_NOT_ALLOWED',
    });
    expect(s3.objects.size).toBe(0);
    expect(await db.attachment.count()).toBe(0);
  });

  it('upload confirmation: missing, foreign, cross-issue, malformed and repeated confirms', async () => {
    const w = await world();
    const { body, mimeType } = SAMPLES['notes.txt']!;
    const init = await w.initiate(w.c.member, w.issue.id, {
      filename: 'notes.txt',
      mimeType,
      sizeBytes: body.length,
    });
    const { uploadId } = init.body.upload;

    // Initiated but never uploaded (failed upload): nothing to confirm, nothing to download.
    const missing = await w.confirm(w.c.member, w.issue.id, uploadId);
    expect(missing.status).toBe(422);
    expect(missing.body).toMatchObject({
      code: 'FILE_REJECTED',
      details: { reason: 'UPLOAD_MISSING' },
    });
    expect(
      (await w.confirm(w.c.member, w.issue.id, '00000000-0000-4000-8000-000000000000')).status,
    ).toBe(422);
    expect((await w.confirm(w.c.member, w.issue.id, 'not-a-uuid')).status).toBe(422);

    expect((await w.put(init.body.upload, body)).status).toBe(200);
    // Another user, or the same upload against another issue, cannot claim it.
    expect((await w.confirm(w.c.member2, w.issue.id, uploadId)).status).toBe(404);
    expect((await w.confirm(w.c.member, w.other.id, uploadId)).status).toBe(404);
    expect((await w.confirm(w.c.rival, w.issue.id, uploadId)).status).toBe(404);

    const first = await w.confirm(w.c.member, w.issue.id, uploadId);
    const again = await w.confirm(w.c.member, w.issue.id, uploadId);
    expect(first.status).toBe(201);
    expect(again.body.attachment.id).toBe(first.body.attachment.id);
    expect((await w.confirm(w.c.member, w.other.id, uploadId)).status).toBe(404);
    expect(await db.attachment.count()).toBe(1);
  });

  it('expired signed upload URL is refused and cannot be confirmed', async () => {
    const w = await world();
    const { body, mimeType } = SAMPLES['data.csv']!;
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 301_000 });
    const init = await w.initiate(w.c.member, w.issue.id, {
      filename: 'data.csv',
      mimeType,
      sizeBytes: body.length,
    });
    vi.useRealTimers();
    expect(init.status).toBe(201);
    expect(new URL(init.body.upload.url).searchParams.get('X-Amz-Expires')).toBe('300');
    expect((await w.put(init.body.upload, body)).status).toBe(403);
    expect(
      (await w.confirm(w.c.member, w.issue.id, init.body.upload.uploadId)).body.details,
    ).toEqual({
      reason: 'UPLOAD_MISSING',
    });
  });

  it('TC-ISS-006-2 download: members get a 5-minute attachment URL; it expires', async () => {
    const w = await world();
    const { body, mimeType } = SAMPLES['spec.pdf']!;
    const { res } = await w.upload(w.c.member, w.issue.id, 'Q3 spec "final".pdf', body, mimeType);
    const aid = res.body.attachment.id;

    const dl = await w.download(w.c.member2, aid);
    expect(dl.status).toBe(200);
    expect(dl.headers['cache-control']).toBe('no-store');
    const url = new URL(dl.body.download.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(new Date(dl.body.download.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      300_000,
    );
    const file = await fetch(url);
    expect(file.status).toBe(200);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(body);
    expect(file.headers.get('content-disposition')).toMatch(
      /^attachment; filename="Q3 spec _final_.pdf"/,
    );
    expect(file.headers.get('content-type')).toBe('application/pdf');

    // The bucket is private: the object itself is not reachable without a signature.
    const key = (await db.attachment.findUniqueOrThrow({ where: { id: aid } })).objectKey;
    expect((await fetch(`${s3.endpoint}/${url.pathname.split('/')[1]}/${key}`)).status).toBe(403);

    // A URL signed more than five minutes ago is refused by storage.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 301_000 });
    const old = await w.download(w.c.member, aid);
    vi.useRealTimers();
    expect((await fetch(old.body.download.url)).status).toBe(403);

    // The adapter never signs for longer than five minutes, whatever is asked.
    const long = await s3.storage.getSignedUrl(
      key,
      { filename: 'x.pdf', contentType: mimeType },
      3600,
    );
    expect(new URL(long.url).searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('TC-ISS-006-2 non-project members and other tenants get 404 for list, upload and download', async () => {
    const w = await world();
    const { body, mimeType } = SAMPLES['shot.png']!;
    const { res } = await w.upload(w.c.member, w.issue.id, 'shot.png', body, mimeType);
    const aid = res.body.attachment.id;
    const declared = { filename: 'x.png', mimeType, sizeBytes: body.length };

    for (const cookie of [w.c.outsider, w.c.rival]) {
      expect((await w.download(cookie, aid)).status).toBe(404);
      expect((await w.list(cookie, w.issue.id)).status).toBe(404);
      expect((await w.initiate(cookie, w.issue.id, declared)).status).toBe(404);
    }
    expect((await w.download(w.c.rival, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await w.download(w.c.rival, 'garbage')).status).toBe(404);
    expect((await request(w.app).get(`${api}/attachments/${aid}/download`)).status).toBe(401);
    // Owner/Admin see every project in their workspace.
    expect((await w.download(w.c.owner, aid)).status).toBe(200);

    // Removing project membership revokes download access.
    await db.projectMember.update({
      where: { projectId_userId: { projectId: w.pid, userId: w.u.member2.id } },
      data: { status: 'REMOVED' },
    });
    expect((await w.download(w.c.member2, aid)).status).toBe(404);
  });

  it('missing object for a confirmed attachment returns 404 rather than a dead URL', async () => {
    const w = await world();
    const { body, mimeType } = SAMPLES['notes.txt']!;
    const { res } = await w.upload(w.c.member, w.issue.id, 'notes.txt', body, mimeType);
    s3.objects.clear();
    expect((await w.download(w.c.member, res.body.attachment.id)).status).toBe(404);
  });

  it('archived project, suspended workspace and deleted issue block uploads', async () => {
    const w = await world();
    const { body, mimeType } = SAMPLES['notes.txt']!;
    const { uploadId, res } = await w.upload(w.c.member, w.issue.id, 'notes.txt', body, mimeType);
    const aid = res.body.attachment.id;
    const declared = { filename: 'n.txt', mimeType, sizeBytes: body.length };

    await db.project.update({
      where: { id: w.pid },
      data: { archivedAt: new Date(), archivedById: w.u.owner.id },
    });
    const archived = await w.initiate(w.c.pm, w.issue.id, declared);
    expect(archived.status).toBe(409);
    expect(archived.body.code).toBe('PROJECT_ARCHIVED');
    expect((await w.confirm(w.c.member, w.issue.id, uploadId)).status).toBe(409);
    // Archived projects stay readable.
    expect((await w.list(w.c.member, w.issue.id)).status).toBe(200);
    expect((await w.download(w.c.member, aid)).status).toBe(200);
    await db.project.update({
      where: { id: w.pid },
      data: { archivedAt: null, archivedById: null },
    });

    await db.workspace.update({
      where: { id: w.wid },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    const suspended = await w.initiate(w.c.owner, w.issue.id, declared);
    expect(suspended.status).toBe(403);
    expect(suspended.body.code).toBe('WORKSPACE_SUSPENDED');
    await db.workspace.update({
      where: { id: w.wid },
      data: { status: 'ACTIVE', suspendedAt: null },
    });

    await db.issue.update({
      where: { id: w.issue.id },
      data: { deletedAt: new Date(), deletedById: w.u.pm.id },
    });
    expect((await w.initiate(w.c.pm, w.issue.id, declared)).status).toBe(409);
    // Soft-deleted issues (and their files) are hidden from Members.
    expect((await w.list(w.c.member, w.issue.id)).status).toBe(404);
    expect((await w.download(w.c.member, aid)).status).toBe(404);
  });
});
