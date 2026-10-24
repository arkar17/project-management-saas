import { afterAll, beforeEach } from 'vitest';
import { hashPassword } from '../../src/lib/password.js';
import { createPrisma } from '../../src/lib/prisma.js';

const url = process.env.DATABASE_URL ?? '';
// Integration tests TRUNCATE every table; refuse anything but a disposable *_test database.
if (!/\/[A-Za-z0-9_]+_test(\?|$)/.test(url)) {
  throw new Error('DATABASE_URL must point at a disposable database whose name ends in _test');
}

export const db = createPrisma(url);

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  if (list) await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await db.$disconnect();
});

export const PASSWORD = 'correct-horse-battery';

export async function createUser(email: string, opts: { verified?: boolean } = {}) {
  return db.user.create({
    data: {
      email,
      name: email.split('@')[0]!,
      passwordHash: await hashPassword(PASSWORD),
      verifiedAt: opts.verified === false ? null : new Date(),
    },
  });
}

/** Workspace with an ACTIVE OWNER and one project; returns ids used by tenant tests. */
export async function createWorkspace(slug: string, ownerId: string) {
  const workspace = await db.workspace.create({ data: { slug, name: slug, timezone: 'UTC' } });
  await db.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: ownerId, role: 'OWNER' },
  });
  const project = await db.project.create({
    data: {
      workspaceId: workspace.id,
      key: slug.slice(0, 4).toUpperCase(),
      name: slug,
      createdById: ownerId,
    },
  });
  return { workspace, project };
}

export async function createIssue(
  workspaceId: string,
  projectId: string,
  reporterId: string,
  extra: { parentId?: string; deletedAt?: Date; assigneeId?: string } = {},
) {
  const project = await db.project.update({
    where: { id: projectId },
    data: { issueCounter: { increment: 1 } },
  });
  return db.issue.create({
    data: {
      workspaceId,
      projectId,
      number: project.issueCounter,
      key: `${project.key}-${project.issueCounter}`,
      type: 'TASK',
      title: 'Issue',
      reporterId,
      rank: `a${project.issueCounter}`,
      ...extra,
    },
  });
}
