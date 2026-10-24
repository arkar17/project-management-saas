import {
  ErrorCode,
  slugify,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceDetailDto,
  type WorkspaceSummaryDto,
} from '@pm/shared';
import { Prisma, type Workspace, type WorkspaceRole } from '@prisma/client';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict } from '../../lib/errors.js';
import type { Db } from '../../lib/prisma.js';
import type { WorkspaceAccess } from '../../policy/access.js';

function toSummary(ws: Workspace, myRole: WorkspaceRole): WorkspaceSummaryDto {
  return {
    id: ws.id,
    slug: ws.slug,
    name: ws.name,
    timezone: ws.timezone,
    status: ws.status,
    myRole,
  };
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export function createWorkspaceService(db: Db) {
  return {
    /** FR-TEN-001 / TC-TEN-001-1: workspace and its sole OWNER are created in one transaction. */
    async create(userId: string, input: CreateWorkspaceInput): Promise<WorkspaceSummaryDto> {
      const slug = input.slug ?? slugify(input.name);
      if (slug.length < 3) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_ERROR,
          'Choose a slug of at least 3 characters',
          [{ path: 'slug', message: 'Slug must be at least 3 characters' }],
        );
      }
      try {
        return await db.$transaction(async (tx) => {
          const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
          const workspace = await tx.workspace.create({
            data: { slug, name: input.name, timezone: input.timezone ?? user.timezone },
          });
          await tx.workspaceMember.create({
            data: { workspaceId: workspace.id, userId, role: 'OWNER' },
          });
          await writeAudit(tx, {
            workspaceId: workspace.id,
            actorId: userId,
            action: 'workspace.created',
            targetType: 'Workspace',
            targetId: workspace.id,
            metadata: { slug },
          });
          return toSummary(workspace, 'OWNER');
        });
      } catch (err) {
        if (isUniqueViolation(err))
          throw conflict(ErrorCode.SLUG_TAKEN, 'That workspace URL is taken');
        throw err;
      }
    },

    /** Only ACTIVE memberships are listed; switching re-authorises per request (FR-TEN-005). */
    async listForUser(userId: string): Promise<WorkspaceSummaryDto[]> {
      const memberships = await db.workspaceMember.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { workspace: true },
        orderBy: { workspace: { name: 'asc' } },
      });
      return memberships.map((m) => toSummary(m.workspace, m.role));
    },

    async getDetail(access: WorkspaceAccess): Promise<WorkspaceDetailDto> {
      const isAdmin = access.workspaceRole !== 'MEMBER';
      const [workspace, memberCount, projectCount] = await Promise.all([
        db.workspace.findUniqueOrThrow({ where: { id: access.workspaceId } }),
        db.workspaceMember.count({ where: { workspaceId: access.workspaceId, status: 'ACTIVE' } }),
        db.project.count({
          where: {
            workspaceId: access.workspaceId,
            ...(isAdmin ? {} : { members: { some: { userId: access.userId, status: 'ACTIVE' } } }),
          },
        }),
      ]);
      return {
        ...toSummary(workspace, access.workspaceRole),
        memberCount,
        projectCount,
        createdAt: workspace.createdAt.toISOString(),
      };
    },

    /** FR-TEN-007: name and reporting timezone; slug is immutable. */
    async update(
      access: WorkspaceAccess,
      input: UpdateWorkspaceInput,
    ): Promise<WorkspaceSummaryDto> {
      return db.$transaction(async (tx) => {
        const before = await tx.workspace.findUniqueOrThrow({ where: { id: access.workspaceId } });
        const workspace = await tx.workspace.update({
          where: { id: access.workspaceId },
          data: input,
        });
        await writeAudit(tx, {
          workspaceId: workspace.id,
          actorId: access.userId,
          action: 'workspace.updated',
          targetType: 'Workspace',
          targetId: workspace.id,
          metadata: {
            ...(input.name ? { name: { from: before.name, to: workspace.name } } : {}),
            ...(input.timezone
              ? { timezone: { from: before.timezone, to: workspace.timezone } }
              : {}),
          },
        });
        return toSummary(workspace, access.workspaceRole);
      });
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
