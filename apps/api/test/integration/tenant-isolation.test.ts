import { describe, expect, it } from 'vitest';
import {
  assertIssueFieldsAllowed,
  assertWritable,
  resolveIssueAccess,
  resolveProjectAccess,
  resolveWorkspaceAccess,
} from '../../src/policy/access.js';
import { createIssue, createUser, createWorkspace, db } from './setup.js';

async function twoTenants() {
  const alice = await createUser('alice@a.test');
  const bob = await createUser('bob@b.test');
  const a = await createWorkspace('alpha', alice.id);
  const b = await createWorkspace('bravo', bob.id);
  return { alice, bob, a, b };
}

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status ?? 500,
  );

describe('Policy service ancestry checks (ADR-002, NFR-01)', () => {
  it('guessed IDs from another workspace resolve to 404', async () => {
    const { alice, b, bob } = await twoTenants();
    const issue = await createIssue(b.workspace.id, b.project.id, bob.id);
    expect(await status(resolveWorkspaceAccess(db, alice.id, b.workspace.id))).toBe(404);
    expect(await status(resolveProjectAccess(db, alice.id, b.project.id))).toBe(404);
    expect(await status(resolveIssueAccess(db, alice.id, issue.id))).toBe(404);
  });

  it('workspace members need an ACTIVE project row; Owner/Admin have implicit access', async () => {
    const { alice, a } = await twoTenants();
    const carol = await createUser('carol@a.test');
    await db.workspaceMember.create({
      data: { workspaceId: a.workspace.id, userId: carol.id, role: 'MEMBER' },
    });
    expect(await status(resolveProjectAccess(db, carol.id, a.project.id))).toBe(404);

    const pm = await db.projectMember.create({
      data: { projectId: a.project.id, userId: carol.id, role: 'PROJECT_MANAGER' },
    });
    expect((await resolveProjectAccess(db, carol.id, a.project.id)).actor).toBe('PROJECT_MANAGER');
    expect((await resolveProjectAccess(db, alice.id, a.project.id)).actor).toBe('OWNER');

    await db.projectMember.update({
      where: { id: pm.id },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    expect(await status(resolveProjectAccess(db, carol.id, a.project.id))).toBe(404);
  });

  it('removed workspace members lose access', async () => {
    const { a } = await twoTenants();
    const dan = await createUser('dan@a.test');
    await db.workspaceMember.create({
      data: {
        workspaceId: a.workspace.id,
        userId: dan.id,
        role: 'ADMIN',
        status: 'REMOVED',
        removedAt: new Date(),
      },
    });
    expect(await status(resolveProjectAccess(db, dan.id, a.project.id))).toBe(404);
  });

  it('soft-deleted issues are hidden from Members but visible to PM+', async () => {
    const { alice, a } = await twoTenants();
    const erin = await createUser('erin@a.test');
    await db.workspaceMember.create({
      data: { workspaceId: a.workspace.id, userId: erin.id, role: 'MEMBER' },
    });
    await db.projectMember.create({
      data: { projectId: a.project.id, userId: erin.id, role: 'MEMBER' },
    });
    const issue = await createIssue(a.workspace.id, a.project.id, erin.id, {
      deletedAt: new Date(),
    });
    expect(await status(resolveIssueAccess(db, erin.id, issue.id))).toBe(404);
    expect(await status(resolveIssueAccess(db, alice.id, issue.id))).toBe(200);
  });

  it('Member field allow-list: own issue title/status only (ADR-008)', async () => {
    const { alice, a } = await twoTenants();
    const finn = await createUser('finn@a.test');
    await db.workspaceMember.create({
      data: { workspaceId: a.workspace.id, userId: finn.id, role: 'MEMBER' },
    });
    await db.projectMember.create({
      data: { projectId: a.project.id, userId: finn.id, role: 'MEMBER' },
    });
    const own = await createIssue(a.workspace.id, a.project.id, finn.id);
    const other = await createIssue(a.workspace.id, a.project.id, alice.id);

    const ownAccess = await resolveIssueAccess(db, finn.id, own.id);
    expect(() => assertIssueFieldsAllowed(ownAccess, ['title', 'status'])).not.toThrow();
    expect(() => assertIssueFieldsAllowed(ownAccess, ['priority'])).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    const otherAccess = await resolveIssueAccess(db, finn.id, other.id);
    expect(() => assertIssueFieldsAllowed(otherAccess, ['title'])).toThrow(
      expect.objectContaining({ code: 'FIELD_FORBIDDEN' }),
    );
  });

  it('suspended workspaces refuse writes (403) and archived projects refuse writes (409)', async () => {
    const { alice, a } = await twoTenants();
    await db.workspace.update({
      where: { id: a.workspace.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });
    const suspended = await resolveProjectAccess(db, alice.id, a.project.id);
    expect(() => assertWritable(suspended)).toThrow(
      expect.objectContaining({ code: 'WORKSPACE_SUSPENDED' }),
    );

    await db.workspace.update({
      where: { id: a.workspace.id },
      data: { status: 'ACTIVE', suspendedAt: null },
    });
    await db.project.update({
      where: { id: a.project.id },
      data: { archivedAt: new Date(), archivedById: alice.id },
    });
    const archived = await resolveProjectAccess(db, alice.id, a.project.id);
    expect(() => assertWritable(archived)).toThrow(
      expect.objectContaining({ status: 409, code: 'PROJECT_ARCHIVED' }),
    );
  });
});

describe('Database-enforced integrity (ADR-011, ADR-019)', () => {
  it('rejects an issue whose project belongs to another workspace (composite FK)', async () => {
    const { alice, a, b } = await twoTenants();
    await expect(
      db.issue.create({
        data: {
          workspaceId: a.workspace.id,
          projectId: b.project.id,
          number: 1,
          key: 'X-1',
          type: 'TASK',
          title: 'cross-tenant',
          reporterId: alice.id,
          rank: 'a',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a parent issue from another project (composite FK)', async () => {
    const { alice, a } = await twoTenants();
    const other = await db.project.create({
      data: { workspaceId: a.workspace.id, key: 'OTH', name: 'Other', createdById: alice.id },
    });
    const parent = await createIssue(a.workspace.id, other.id, alice.id);
    await expect(
      createIssue(a.workspace.id, a.project.id, alice.id, { parentId: parent.id }),
    ).rejects.toThrow();
  });

  it('allows only one ACTIVE OWNER per workspace (partial unique index)', async () => {
    const { a } = await twoTenants();
    const second = await createUser('second@a.test');
    await expect(
      db.workspaceMember.create({
        data: { workspaceId: a.workspace.id, userId: second.id, role: 'OWNER' },
      }),
    ).rejects.toThrow();
  });

  it('allows only one PENDING invitation per workspace + email (partial unique index)', async () => {
    const { alice, a } = await twoTenants();
    const invite = (tokenHash: string) =>
      db.workspaceInvitation.create({
        data: {
          workspaceId: a.workspace.id,
          email: 'new@a.test',
          role: 'MEMBER',
          tokenHash,
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedById: alice.id,
        },
      });
    await invite('h1');
    await expect(invite('h2')).rejects.toThrow();
  });

  it('RESTRICT prevents hard-deleting referenced users', async () => {
    const { alice } = await twoTenants();
    await expect(db.user.delete({ where: { id: alice.id } })).rejects.toThrow();
  });

  it('CHECK constraints reject invalid story points and sprint dates', async () => {
    const { alice, a } = await twoTenants();
    const issue = await createIssue(a.workspace.id, a.project.id, alice.id);
    await expect(
      db.issue.update({ where: { id: issue.id }, data: { storyPoints: 101 } }),
    ).rejects.toThrow();
    const now = new Date();
    await expect(
      db.sprint.create({ data: { projectId: a.project.id, name: 'S', startAt: now, endAt: now } }),
    ).rejects.toThrow();
  });
});
