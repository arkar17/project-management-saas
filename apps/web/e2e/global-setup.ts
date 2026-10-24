import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

/** Deterministic E2E fixtures. Refuses anything but a disposable *_test database. */
export const E2E_PASSWORD = 'e2e-correct-horse';
export const users = {
  root: { email: 'root@e2e.test', name: 'Rita Root' },
  bob: { email: 'bob@e2e.test', name: 'Bob Builder' },
  carol: { email: 'carol@e2e.test', name: 'Carol Outsider' },
};

export default async function globalSetup() {
  const url =
    process.env.E2E_DATABASE_URL ?? 'postgresql://pm:pm_local_only@localhost:5432/pm_test';
  if (!/\/[A-Za-z0-9_]+_test(\?|$)/.test(url)) throw new Error('E2E needs a *_test database');
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    const passwordHash = await hash(E2E_PASSWORD);
    for (const u of Object.values(users)) {
      await db.user.create({ data: { ...u, passwordHash, verifiedAt: new Date() } });
    }
    const root = await db.user.findUniqueOrThrow({ where: { email: users.root.email } });
    await db.platformAdmin.create({ data: { userId: root.id } });
  } finally {
    await db.$disconnect();
  }
}
