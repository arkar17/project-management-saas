import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/tokens.js';
import { buildApp, csrf } from '../helpers.js';
import { createIssue, createUser, createWorkspace, db, signIn } from './setup.js';

const api = '/api/v1';

async function world() {
  const ctx = buildApp({ db });
  const owner = await createUser('owner@acme.test');
  const admin = await createUser('admin@acme.test');
  const member = await createUser('member@acme.test');
  const { app } = ctx;
  const ownerCookie = await signIn(app, owner.email);
  const created = await request(app)
    .post(`${api}/workspaces`)
    .set(csrf([ownerCookie]))
    .send({ name: 'Acme Inc', timezone: 'Europe/Berlin' });
  const wid: string = created.body.workspace.id;
  const adminRow = await db.workspaceMember.create({
    data: { workspaceId: wid, userId: admin.id, role: 'ADMIN' },
  });
  const memberRow = await db.workspaceMember.create({
    data: { workspaceId: wid, userId: member.id, role: 'MEMBER' },
  });
  const ownerRow = await db.workspaceMember.findFirstOrThrow({
    where: { workspaceId: wid, role: 'OWNER' },
  });
  return {
    ...ctx,
    wid,
    owner,
    admin,
    member,
    ownerRow,
    adminRow,
    memberRow,
    ownerCookie,
    adminCookie: await signIn(app, admin.email),
    memberCookie: await signIn(app, member.email),
  };
}

const as = (cookie: string) => csrf([cookie]);

describe('FR-TEN-001 workspace creation', () => {
  it('TC-TEN-001-1 creates the workspace and its sole ACTIVE OWNER atomically, with audit', async () => {
    const { wid, owner } = await world();
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: wid } });
    expect(ws.slug).toBe('acme-inc');
    expect(ws.timezone).toBe('Europe/Berlin');
    const owners = await db.workspaceMember.findMany({
      where: { workspaceId: wid, role: 'OWNER', status: 'ACTIVE' },
    });
    expect(owners.map((o) => o.userId)).toEqual([owner.id]);
    expect(
      await db.auditLog.count({ where: { workspaceId: wid, action: 'workspace.created' } }),
    ).toBe(1);
  });

  it('TC-TEN-001-2 duplicate (normalised) slug → 409 SLUG_TAKEN', async () => {
    const { app, ownerCookie } = await world();
    const res = await request(app)
      .post(`${api}/workspaces`)
      .set(as(ownerCookie))
      .send({ name: 'Other', slug: 'ACME inc' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
  });

  it('defaults the timezone to the creator timezone', async () => {
    const { app } = buildApp({ db });
    const u = await createUser('tz@x.test');
    await db.user.update({ where: { id: u.id }, data: { timezone: 'Asia/Tokyo' } });
    const res = await request(app)
      .post(`${api}/workspaces`)
      .set(as(await signIn(app, u.email)))
      .send({ name: 'Tokyo Team' });
    expect(res.status).toBe(201);
    expect(res.body.workspace.timezone).toBe('Asia/Tokyo');
  });

  it('TC-AUTH-001-3 unverified users are blocked from workspace actions (403)', async () => {
    const { app } = buildApp({ db });
    const u = await createUser('unverified@x.test', { verified: false });
    const cookie = await signIn(app, u.email);
    const create = await request(app)
      .post(`${api}/workspaces`)
      .set(as(cookie))
      .send({ name: 'Nope Team' });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await request(app).get(`${api}/workspaces`).set('Cookie', cookie)).status).toBe(403);
    expect(await db.workspace.count()).toBe(0);
  });
});

describe('FR-TEN-002 invitations', () => {
  it('TC-TEN-002-1 inviting with role OWNER is rejected (422)', async () => {
    const { app, wid, ownerCookie } = await world();
    const res = await request(app)
      .post(`${api}/workspaces/${wid}/invitations`)
      .set(as(ownerCookie))
      .send({ email: 'x@y.test', role: 'OWNER' });
    expect(res.status).toBe(422);
  });

  it('TC-TEN-002-2 second PENDING invitation for the same email → 409; Members cannot invite', async () => {
    const { app, wid, ownerCookie, adminCookie, memberCookie } = await world();
    const send = (cookie: string, email = 'New@Person.test') =>
      request(app)
        .post(`${api}/workspaces/${wid}/invitations`)
        .set(as(cookie))
        .send({ email, role: 'MEMBER' });
    expect((await send(ownerCookie)).status).toBe(201);
    const dup = await send(adminCookie, 'new@person.test');
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('INVITE_EXISTS');
    expect((await send(memberCookie, 'other@person.test')).status).toBe(403);
    const already = await send(ownerCookie, 'member@acme.test');
    expect(already.body.code).toBe('ALREADY_MEMBER');
  });

  it('an expired PENDING invitation does not block a new one (lazy expiry)', async () => {
    const { app, wid, ownerCookie } = await world();
    const send = () =>
      request(app)
        .post(`${api}/workspaces/${wid}/invitations`)
        .set(as(ownerCookie))
        .send({ email: 'late@x.test', role: 'MEMBER' });
    await send();
    await db.workspaceInvitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await send()).status).toBe(201);
    expect(await db.workspaceInvitation.count({ where: { state: 'EXPIRED' } })).toBe(1);
  });

  it('TC-TEN-002-3 resend revokes the old token and issues a new one', async () => {
    const { app, wid, ownerCookie, mailer, member, memberCookie } = await world();
    const created = await request(app)
      .post(`${api}/workspaces/${wid}/invitations`)
      .set(as(ownerCookie))
      .send({ email: 'join@x.test', role: 'ADMIN' });
    const oldToken = mailer.tokenFrom(mailer.last('join@x.test'));
    const resent = await request(app)
      .post(`${api}/invitations/${created.body.invitation.id}/resend`)
      .set(as(ownerCookie));
    expect(resent.status).toBe(201);
    const newToken = mailer.tokenFrom(mailer.last('join@x.test'));
    expect(newToken).not.toBe(oldToken);
    const old = await db.workspaceInvitation.findUniqueOrThrow({
      where: { tokenHash: hashToken(oldToken) },
    });
    expect(old.state).toBe('REVOKED');
    expect(
      (await request(app).get(`${api}/invitations/preview`).query({ token: oldToken })).status,
    ).toBe(410);
    const preview = await request(app).get(`${api}/invitations/preview`).query({ token: newToken });
    expect(preview.status).toBe(200);
    expect(preview.body.invitation).toMatchObject({
      workspaceName: 'Acme Inc',
      role: 'ADMIN',
      email: 'join@x.test',
    });
    // Members cannot see or manage invitations (FR-TEN-008): 404 by id, 403 on the list.
    expect(
      (
        await request(app)
          .post(`${api}/invitations/${resent.body.invitation.id}/revoke`)
          .set(as(memberCookie))
      ).status,
    ).toBe(404);
    expect(
      (await request(app).get(`${api}/workspaces/${wid}/invitations`).set('Cookie', memberCookie))
        .status,
    ).toBe(403);
    expect(member).toBeDefined();
  });

  it('TC-TEN-002-4 inviting in a suspended workspace → 403 WORKSPACE_SUSPENDED', async () => {
    const { app, wid, ownerCookie } = await world();
    await db.workspace.update({
      where: { id: wid },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    const res = await request(app)
      .post(`${api}/workspaces/${wid}/invitations`)
      .set(as(ownerCookie))
      .send({ email: 'x@y.test', role: 'MEMBER' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WORKSPACE_SUSPENDED');
    const patch = await request(app)
      .patch(`${api}/workspaces/${wid}`)
      .set(as(ownerCookie))
      .send({ name: 'Renamed' });
    expect(patch.status).toBe(403);
  });
});

describe('FR-TEN-003 acceptance', () => {
  async function invite(ctx: Awaited<ReturnType<typeof world>>, email: string) {
    await request(ctx.app)
      .post(`${api}/workspaces/${ctx.wid}/invitations`)
      .set(as(ctx.ownerCookie))
      .send({ email, role: 'MEMBER' });
    return ctx.mailer.tokenFrom(ctx.mailer.last(email));
  }

  it('TC-TEN-003-1 matching verified email creates the member; a REMOVED member is reactivated', async () => {
    const ctx = await world();
    const guest = await createUser('guest@x.test');
    const token = await invite(ctx, 'guest@x.test');
    const cookie = await signIn(ctx.app, guest.email);
    const res = await request(ctx.app)
      .post(`${api}/invitations/accept`)
      .set(as(cookie))
      .send({ token });
    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe(ctx.wid);
    expect(
      (await request(ctx.app).get(`${api}/workspaces/${ctx.wid}`).set('Cookie', cookie)).status,
    ).toBe(200);

    await request(ctx.app)
      .delete(
        `${api}/workspaces/${ctx.wid}/members/${(await db.workspaceMember.findFirstOrThrow({ where: { userId: guest.id } })).id}`,
      )
      .set(as(ctx.ownerCookie));
    const again = await invite(ctx, 'guest@x.test');
    expect(
      (
        await request(ctx.app)
          .post(`${api}/invitations/accept`)
          .set(as(cookie))
          .send({ token: again })
      ).status,
    ).toBe(200);
    const rows = await db.workspaceMember.findMany({ where: { userId: guest.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', role: 'MEMBER', removedAt: null });
  });

  it('TC-TEN-003-2 email mismatch → 403 INVITATION_EMAIL_MISMATCH and no membership', async () => {
    const ctx = await world();
    const token = await invite(ctx, 'intended@x.test');
    const intruder = await createUser('intruder@x.test');
    const res = await request(ctx.app)
      .post(`${api}/invitations/accept`)
      .set(as(await signIn(ctx.app, intruder.email)))
      .send({ token });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVITATION_EMAIL_MISMATCH');
    expect(await db.workspaceMember.count({ where: { userId: intruder.id } })).toBe(0);
  });

  it('TC-TEN-003-3 expired/revoked/used → 410; already ACTIVE → 409', async () => {
    const ctx = await world();
    const guest = await createUser('g2@x.test');
    const cookie = await signIn(ctx.app, guest.email);
    const accept = (token: string, c = cookie) =>
      request(ctx.app).post(`${api}/invitations/accept`).set(as(c)).send({ token });

    const used = await invite(ctx, 'g2@x.test');
    expect((await accept(used)).status).toBe(200);
    expect((await accept(used)).status).toBe(410);

    const revoked = await invite(ctx, 'g3@x.test');
    const inv = await db.workspaceInvitation.findUniqueOrThrow({
      where: { tokenHash: hashToken(revoked) },
    });
    await request(ctx.app).post(`${api}/invitations/${inv.id}/revoke`).set(as(ctx.adminCookie));
    expect((await accept(revoked)).status).toBe(410);

    const expired = await invite(ctx, 'g4@x.test');
    await db.workspaceInvitation.update({
      where: { tokenHash: hashToken(expired) },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect((await accept(expired)).status).toBe(410);

    // Invitation for an address that is already an ACTIVE member.
    const dupToken = 'already-member-token';
    await db.workspaceInvitation.create({
      data: {
        workspaceId: ctx.wid,
        email: 'member@acme.test',
        role: 'ADMIN',
        tokenHash: hashToken(dupToken),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedById: ctx.owner.id,
      },
    });
    const conflict = await accept(dupToken, ctx.memberCookie);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('ALREADY_MEMBER');
  });
});

describe('FR-TEN-004 member management', () => {
  it('TC-TEN-004-1/2 removal cascade revokes project access, unassigns open issues, deletes watches; history kept', async () => {
    const ctx = await world();
    const project = await db.project.create({
      data: { workspaceId: ctx.wid, key: 'ACM', name: 'Acme', createdById: ctx.owner.id },
    });
    await db.projectMember.create({
      data: { projectId: project.id, userId: ctx.member.id, role: 'MEMBER' },
    });
    const open = await createIssue(ctx.wid, project.id, ctx.owner.id, {
      assigneeId: ctx.member.id,
    });
    const done = await createIssue(ctx.wid, project.id, ctx.owner.id, {
      assigneeId: ctx.member.id,
    });
    await db.issue.update({ where: { id: done.id }, data: { status: 'DONE' } });
    await db.issueWatcher.create({ data: { issueId: open.id, userId: ctx.member.id } });
    await db.issueComment.create({
      data: { issueId: open.id, authorId: ctx.member.id, body: 'kept' },
    });

    const res = await request(ctx.app)
      .delete(`${api}/workspaces/${ctx.wid}/members/${ctx.memberRow.id}`)
      .set(as(ctx.adminCookie));
    expect(res.status).toBe(204);

    expect(
      (await db.workspaceMember.findUniqueOrThrow({ where: { id: ctx.memberRow.id } })).status,
    ).toBe('REMOVED');
    expect(
      (await db.projectMember.findFirstOrThrow({ where: { userId: ctx.member.id } })).status,
    ).toBe('REMOVED');
    expect((await db.issue.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBeNull();
    expect((await db.issue.findUniqueOrThrow({ where: { id: done.id } })).assigneeId).toBe(
      ctx.member.id,
    );
    expect(
      await db.issueActivity.count({
        where: { issueId: open.id, field: 'assigneeId', oldValue: ctx.member.id },
      }),
    ).toBe(1);
    expect(await db.issueWatcher.count({ where: { userId: ctx.member.id } })).toBe(0);
    expect(await db.issueComment.count({ where: { authorId: ctx.member.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'member.removed' } })).toBe(1);

    // Immediate access revocation: the still-valid session can no longer read the workspace.
    expect(
      (await request(ctx.app).get(`${api}/workspaces/${ctx.wid}`).set('Cookie', ctx.memberCookie))
        .status,
    ).toBe(404);
    expect(
      (await request(ctx.app).get(`${api}/workspaces`).set('Cookie', ctx.memberCookie)).body
        .workspaces,
    ).toEqual([]);
  });

  it('TC-TEN-004-3 Admin cannot change/remove the Owner (403); the Owner is protected (409)', async () => {
    const ctx = await world();
    const ownerUrl = `${api}/workspaces/${ctx.wid}/members/${ctx.ownerRow.id}`;
    expect(
      (await request(ctx.app).patch(ownerUrl).set(as(ctx.adminCookie)).send({ role: 'MEMBER' }))
        .status,
    ).toBe(403);
    expect((await request(ctx.app).delete(ownerUrl).set(as(ctx.adminCookie))).status).toBe(403);
    const self = await request(ctx.app).delete(ownerUrl).set(as(ctx.ownerCookie));
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('OWNER_PROTECTED');
    // Members cannot manage anyone; Admins can change other members.
    expect(
      (
        await request(ctx.app)
          .patch(`${api}/workspaces/${ctx.wid}/members/${ctx.adminRow.id}`)
          .set(as(ctx.memberCookie))
          .send({ role: 'MEMBER' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(ctx.app)
          .patch(`${api}/workspaces/${ctx.wid}/members/${ctx.memberRow.id}`)
          .set(as(ctx.adminCookie))
          .send({ role: 'ADMIN' })
      ).status,
    ).toBe(204);
    expect(
      (await db.workspaceMember.findUniqueOrThrow({ where: { id: ctx.memberRow.id } })).role,
    ).toBe('ADMIN');
  });
});

describe('FR-TEN-005 tenant isolation', () => {
  it('TC-TEN-005-1 cross-workspace IDs → 404 without data', async () => {
    const ctx = await world();
    const stranger = await createUser('stranger@other.test');
    const other = await createWorkspace('other-co', stranger.id);
    for (const path of ['', '/members', '/invitations']) {
      const res = await request(ctx.app)
        .get(`${api}/workspaces/${other.workspace.id}${path}`)
        .set('Cookie', ctx.ownerCookie);
      expect(res.status, path).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('other-co');
    }
    const mid = (
      await db.workspaceMember.findFirstOrThrow({ where: { workspaceId: other.workspace.id } })
    ).id;
    // A member id from workspace B addressed through workspace A is invisible too.
    expect(
      (
        await request(ctx.app)
          .delete(`${api}/workspaces/${ctx.wid}/members/${mid}`)
          .set(as(ctx.ownerCookie))
      ).status,
    ).toBe(404);
    expect(
      (await request(ctx.app).get(`${api}/workspaces/not-a-uuid`).set('Cookie', ctx.ownerCookie))
        .status,
    ).toBe(404);
  });

  it('TC-TEN-005-2 a workspaceId in the body is ignored', async () => {
    const ctx = await world();
    const stranger = await createUser('s2@other.test');
    const other = await createWorkspace('other-two', stranger.id);
    const res = await request(ctx.app)
      .post(`${api}/workspaces/${ctx.wid}/invitations`)
      .set(as(ctx.ownerCookie))
      .send({ email: 'body@x.test', role: 'MEMBER', workspaceId: other.workspace.id });
    expect(res.status).toBe(201);
    const inv = await db.workspaceInvitation.findUniqueOrThrow({
      where: { id: res.body.invitation.id },
    });
    expect(inv.workspaceId).toBe(ctx.wid);
  });
});

describe('FR-TEN-006 ownership transfer', () => {
  it('TC-TEN-006-1 target becomes OWNER, former Owner ADMIN, exactly one ACTIVE OWNER; session rotated', async () => {
    const ctx = await world();
    const res = await request(ctx.app)
      .post(`${api}/workspaces/${ctx.wid}/transfer-ownership`)
      .set(as(ctx.ownerCookie))
      .send({ memberId: ctx.memberRow.id });
    expect(res.status).toBe(204);
    const owners = await db.workspaceMember.findMany({
      where: { workspaceId: ctx.wid, role: 'OWNER', status: 'ACTIVE' },
    });
    expect(owners.map((o) => o.userId)).toEqual([ctx.member.id]);
    expect(
      (await db.workspaceMember.findUniqueOrThrow({ where: { id: ctx.ownerRow.id } })).role,
    ).toBe('ADMIN');
    expect(await db.auditLog.count({ where: { action: 'workspace.ownership_transferred' } })).toBe(
      1,
    );
    expect(
      (await request(ctx.app).get(`${api}/workspaces`).set('Cookie', ctx.ownerCookie)).status,
    ).toBe(401);
    // Only the Owner may transfer.
    expect(
      (
        await request(ctx.app)
          .post(`${api}/workspaces/${ctx.wid}/transfer-ownership`)
          .set(as(ctx.adminCookie))
          .send({ memberId: ctx.adminRow.id })
      ).status,
    ).toBe(403);
  });

  it('TC-TEN-006-2 concurrent transfers → exactly one succeeds', async () => {
    const ctx = await world();
    const transfer = (memberId: string) =>
      request(ctx.app)
        .post(`${api}/workspaces/${ctx.wid}/transfer-ownership`)
        .set(as(ctx.ownerCookie))
        .send({ memberId });
    const results = await Promise.all([transfer(ctx.adminRow.id), transfer(ctx.memberRow.id)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(204);
    expect(statuses[1]).not.toBe(204);
    const owners = await db.workspaceMember.findMany({
      where: { workspaceId: ctx.wid, role: 'OWNER', status: 'ACTIVE' },
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]!.userId).not.toBe(ctx.owner.id);
  });

  it('rejects unverified or non-member targets (422)', async () => {
    const ctx = await world();
    await db.user.update({ where: { id: ctx.member.id }, data: { verifiedAt: null } });
    const res = await request(ctx.app)
      .post(`${api}/workspaces/${ctx.wid}/transfer-ownership`)
      .set(as(ctx.ownerCookie))
      .send({ memberId: ctx.memberRow.id });
    expect(res.status).toBe(422);
    const self = await request(ctx.app)
      .post(`${api}/workspaces/${ctx.wid}/transfer-ownership`)
      .set(as(ctx.ownerCookie))
      .send({ memberId: ctx.ownerRow.id });
    expect(self.body.code).toBe('NOT_WORKSPACE_MEMBER');
  });
});

describe('FR-TEN-007/008 settings and member visibility', () => {
  it('TC-TEN-007-1 timezone change by Owner/Admin only; IANA validated; audited', async () => {
    const ctx = await world();
    const url = `${api}/workspaces/${ctx.wid}`;
    expect(
      (
        await request(ctx.app)
          .patch(url)
          .set(as(ctx.adminCookie))
          .send({ timezone: 'America/New_York' })
      ).status,
    ).toBe(200);
    expect(
      (await request(ctx.app).patch(url).set(as(ctx.memberCookie)).send({ timezone: 'UTC' }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(ctx.app)
          .patch(url)
          .set(as(ctx.ownerCookie))
          .send({ timezone: 'Nowhere/Land' })
      ).status,
    ).toBe(422);
    expect((await db.workspace.findUniqueOrThrow({ where: { id: ctx.wid } })).timezone).toBe(
      'America/New_York',
    );
    expect(await db.auditLog.count({ where: { action: 'workspace.updated' } })).toBe(1);
  });

  it('TC-TEN-008-1 Members see names/roles but no emails; Owner/Admin see emails', async () => {
    const ctx = await world();
    const asMember = await request(ctx.app)
      .get(`${api}/workspaces/${ctx.wid}/members`)
      .set('Cookie', ctx.memberCookie);
    expect(asMember.status).toBe(200);
    expect(asMember.body.members).toHaveLength(3);
    expect(JSON.stringify(asMember.body)).not.toContain('@acme.test');
    expect(asMember.body.members[0]).toMatchObject({ name: 'owner', role: 'OWNER' });
    const asAdmin = await request(ctx.app)
      .get(`${api}/workspaces/${ctx.wid}/members`)
      .set('Cookie', ctx.adminCookie);
    expect(asAdmin.body.members.map((m: { email: string }) => m.email)).toContain(
      'member@acme.test',
    );
  });

  it('workspace detail returns scoped counts for the dashboard', async () => {
    const ctx = await world();
    const p = await db.project.create({
      data: { workspaceId: ctx.wid, key: 'ONE', name: 'One', createdById: ctx.owner.id },
    });
    await db.project.create({
      data: { workspaceId: ctx.wid, key: 'TWO', name: 'Two', createdById: ctx.owner.id },
    });
    await db.projectMember.create({
      data: { projectId: p.id, userId: ctx.member.id, role: 'MEMBER' },
    });
    const asOwner = await request(ctx.app)
      .get(`${api}/workspaces/${ctx.wid}`)
      .set('Cookie', ctx.ownerCookie);
    expect(asOwner.body.workspace).toMatchObject({
      memberCount: 3,
      projectCount: 2,
      myRole: 'OWNER',
    });
    const asMember = await request(ctx.app)
      .get(`${api}/workspaces/${ctx.wid}`)
      .set('Cookie', ctx.memberCookie);
    expect(asMember.body.workspace).toMatchObject({ projectCount: 1, myRole: 'MEMBER' });
  });
});
