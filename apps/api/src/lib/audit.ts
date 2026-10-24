import type { AuditActorType, Prisma } from '@prisma/client';

export interface AuditEntry {
  workspaceId: string | null;
  actorId: string | null;
  actorType?: AuditActorType;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Prisma.InputJsonObject;
}

/** Append-only audit trail; always written inside the transaction of the change it records. */
export function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      workspaceId: entry.workspaceId,
      actorId: entry.actorId,
      actorType: entry.actorType ?? 'USER',
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? {},
    },
  });
}
