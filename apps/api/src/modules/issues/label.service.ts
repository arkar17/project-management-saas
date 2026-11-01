import { ErrorCode, type LabelDto } from '@pm/shared';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import {
  assertCan,
  assertId,
  assertWritable,
  resolveProjectAccess,
  type ProjectAccess,
} from '../../policy/access.js';

const toDto = (l: { id: string; name: string; color: string }): LabelDto => ({
  id: l.id,
  name: l.name,
  color: l.color,
});

const taken = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    ? conflict(ErrorCode.LABEL_TAKEN, 'A label with that name already exists')
    : err;

/** FR-ISS-005: labels are per project; create/rename/delete is PM+ (manageLabels). */
export function createLabelService(db: Db) {
  async function resolve(userId: string, labelId: string) {
    const label = await db.label.findUnique({ where: { id: assertId(labelId) } });
    if (!label) throw notFound();
    const access = await resolveProjectAccess(db, userId, label.projectId);
    assertCan(access, 'manageLabels');
    assertWritable(access);
    return { label, access };
  }

  return {
    async list(access: ProjectAccess): Promise<LabelDto[]> {
      const rows = await db.label.findMany({
        where: { projectId: access.projectId },
        orderBy: { name: 'asc' },
      });
      return rows.map(toDto);
    },

    async create(access: ProjectAccess, input: { name: string; color: string }): Promise<LabelDto> {
      assertCan(access, 'manageLabels');
      assertWritable(access);
      try {
        return toDto(await db.label.create({ data: { projectId: access.projectId, ...input } }));
      } catch (err) {
        throw taken(err);
      }
    },

    async update(userId: string, labelId: string, input: { name?: string; color?: string }) {
      const { label } = await resolve(userId, labelId);
      try {
        return toDto(await db.label.update({ where: { id: label.id }, data: input }));
      } catch (err) {
        throw taken(err);
      }
    },

    /** Labels are not history; deleting one cascades its IssueLabel links (ADR-019). */
    async remove(userId: string, labelId: string) {
      const { label } = await resolve(userId, labelId);
      await db.label.delete({ where: { id: label.id } });
    },
  };
}

export type LabelService = ReturnType<typeof createLabelService>;
