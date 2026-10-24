/**
 * Provisions the Platform Super Admin (ADR-007: seed/CLI only, no UI).
 * Idempotent. Credentials come from the environment and are never committed.
 * Run only with approval: `npm run db:seed`.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../apps/api/src/lib/password.js';

const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const name = process.env.PLATFORM_ADMIN_NAME?.trim() || 'Platform Admin';

if (!email || !password || password.length < 10) {
  console.error('Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (min 10 chars).');
  process.exit(1);
}

const db = new PrismaClient();

try {
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email, name, passwordHash, verifiedAt: new Date() },
    });
    const admin = await tx.platformAdmin.upsert({
      where: { userId: user.id },
      update: { status: 'ACTIVE', revokedAt: null },
      create: { userId: user.id },
    });
    await tx.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: 'platform_admin.provisioned',
        targetType: 'PlatformAdmin',
        targetId: admin.id,
        metadata: { via: 'seed' },
      },
    });
  });
  console.log('Platform admin provisioned.');
} finally {
  await db.$disconnect();
}
