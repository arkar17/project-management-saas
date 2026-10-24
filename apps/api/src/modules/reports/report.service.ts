import {
  addDays,
  averageVelocity,
  localDate,
  startOfLocalDay,
  type BurndownDto,
  type VelocityDto,
  type WorkloadDto,
  type WorkspaceOverviewDto,
} from '@pm/shared';
import type { Db } from '../../lib/prisma.js';
import type { ProjectAccess, WorkspaceAccess } from '../../policy/access.js';
import { loadBurndown } from './sprint-metrics.js';

async function workspaceTimezone(db: Db, workspaceId: string) {
  return (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).timezone;
}

/**
 * FR-RPT-001…006. Every aggregate is filtered by projectId sets resolved from the caller's
 * memberships (ADR-002); day boundaries use the workspace timezone and every response states
 * the timezone and date range it used.
 */
export function createReportService(db: Db) {
  return {
    /** FR-RPT-001: only non-archived projects the caller can read; no per-project queries. */
    async workspaceOverview(
      access: WorkspaceAccess,
      now = new Date(),
    ): Promise<WorkspaceOverviewDto> {
      const timezone = await workspaceTimezone(db, access.workspaceId);
      const today = localDate(now, timezone);
      const startToday = startOfLocalDay(today, timezone);
      const endUpcoming = startOfLocalDay(addDays(today, 8), timezone);
      const projects = await db.project.findMany({
        where: {
          workspaceId: access.workspaceId,
          archivedAt: null,
          ...(access.workspaceRole === 'MEMBER'
            ? { members: { some: { userId: access.userId, status: 'ACTIVE' } } }
            : {}),
        },
        select: { id: true, key: true, name: true },
        orderBy: { name: 'asc' },
      });
      const projectIds = projects.map((p) => p.id);
      const live = { projectId: { in: projectIds }, deletedAt: null };
      const open = { ...live, status: { not: 'DONE' as const } };
      const [byProjectStatus, overdue, upcomingCount, upcoming] = await Promise.all([
        db.issue.groupBy({ by: ['projectId', 'status'], where: live, _count: { _all: true } }),
        db.issue.groupBy({
          by: ['projectId'],
          where: { ...open, dueAt: { lt: startToday } },
          _count: { _all: true },
        }),
        db.issue.count({ where: { ...open, dueAt: { gte: startToday, lt: endUpcoming } } }),
        db.issue.findMany({
          where: { ...open, dueAt: { gte: startToday, lt: endUpcoming } },
          select: {
            id: true,
            key: true,
            title: true,
            projectId: true,
            dueAt: true,
            status: true,
            assignee: { select: { id: true, name: true } },
          },
          orderBy: [{ dueAt: 'asc' }, { key: 'asc' }],
          take: 10,
        }),
      ]);

      const byStatus: Record<string, number> = {};
      const perProject = new Map(projectIds.map((id) => [id, { issues: 0, done: 0, overdue: 0 }]));
      for (const g of byProjectStatus) {
        byStatus[g.status] = (byStatus[g.status] ?? 0) + g._count._all;
        const p = perProject.get(g.projectId)!;
        p.issues += g._count._all;
        if (g.status === 'DONE') p.done += g._count._all;
      }
      for (const g of overdue) perProject.get(g.projectId)!.overdue = g._count._all;
      const sum = (k: 'issues' | 'done' | 'overdue') =>
        [...perProject.values()].reduce((s, p) => s + p[k], 0);

      return {
        range: { timezone, from: today, to: addDays(today, 7) },
        totals: {
          projects: projects.length,
          issues: sum('issues'),
          open: sum('issues') - sum('done'),
          done: sum('done'),
          overdue: sum('overdue'),
          upcoming: upcomingCount,
        },
        byStatus,
        projects: projects.map((p) => {
          const m = perProject.get(p.id)!;
          return {
            ...p,
            issues: m.issues,
            open: m.issues - m.done,
            done: m.done,
            overdue: m.overdue,
            progressPercent: m.issues === 0 ? 0 : Math.round((m.done / m.issues) * 100),
          };
        }),
        upcoming: upcoming.map((i) => ({ ...i, dueAt: i.dueAt!.toISOString() })),
      };
    },

    /** FR-RPT-003 with stored daily metrics taking precedence over recomputation (ADR-003). */
    async burndown(sprintId: string, now = new Date()): Promise<BurndownDto> {
      const b = await loadBurndown(db, sprintId, now);
      const stored = new Map(
        (await db.sprintDailyMetric.findMany({ where: { sprintId } })).map((m) => [
          m.metricDate.toISOString().slice(0, 10),
          m,
        ]),
      );
      return {
        range: { timezone: b.timezone, from: b.from, to: b.to },
        sprint: {
          id: b.sprint.id,
          name: b.sprint.name,
          status: b.sprint.status,
          startAt: b.sprint.startAt.toISOString(),
          endAt: b.sprint.endAt.toISOString(),
        },
        committedPoints: b.committedPoints,
        days: b.days.map((d) => {
          const m = stored.get(d.date);
          return m
            ? {
                ...d,
                remainingCommittedPoints: m.remainingCommittedPoints,
                scopeAddedPoints: m.scopeAddedPoints,
              }
            : d;
        }),
        unestimated: b.unestimated,
      };
    },

    /** FR-RPT-004: last N COMPLETED sprints (cancelled never count), oldest first. */
    async velocity(access: ProjectAccess, limit: number, now = new Date()): Promise<VelocityDto> {
      const timezone = await workspaceTimezone(db, access.workspaceId);
      const sprints = await db.sprint.findMany({
        where: { projectId: access.projectId, status: 'COMPLETED', closedAt: { not: null } },
        orderBy: { closedAt: 'desc' },
        take: limit,
        select: { id: true, name: true, closedAt: true },
      });
      const history = await db.sprintIssueHistory.findMany({
        where: { sprintId: { in: sprints.map((s) => s.id) } },
        select: {
          sprintId: true,
          committedAt: true,
          committedPoints: true,
          completedAt: true,
          completedPoints: true,
        },
      });
      const rows = sprints.reverse().map((s) => {
        const h = history.filter((r) => r.sprintId === s.id);
        const completed = h.filter((r) => r.completedAt);
        return {
          id: s.id,
          name: s.name,
          closedAt: s.closedAt!,
          committedPoints: h
            .filter((r) => r.committedAt)
            .reduce((n, r) => n + (r.committedPoints ?? 0), 0),
          completedPoints: completed.reduce((n, r) => n + (r.completedPoints ?? 0), 0),
          unestimatedCompleted: completed.filter((r) => r.completedPoints === null).length,
        };
      });
      const today = localDate(now, timezone);
      return {
        range: {
          timezone,
          from: rows[0] ? localDate(rows[0].closedAt, timezone) : today,
          to: rows.at(-1) ? localDate(rows.at(-1)!.closedAt, timezone) : today,
        },
        averageCompletedPoints: averageVelocity(rows),
        sprints: rows.map((r) => ({ ...r, closedAt: r.closedAt.toISOString() })),
      };
    },

    /** FR-RPT-005: open (not DONE, not deleted) issues of a non-archived project by assignee. */
    async workload(access: ProjectAccess, now = new Date()): Promise<WorkloadDto> {
      const timezone = await workspaceTimezone(db, access.workspaceId);
      const today = localDate(now, timezone);
      const range = { timezone, from: today, to: today };
      if (access.archived) return { range, archived: true, rows: [] };
      const open = {
        projectId: access.projectId,
        deletedAt: null,
        status: { not: 'DONE' as const },
      };
      const [totals, unestimated] = await Promise.all([
        db.issue.groupBy({
          by: ['assigneeId'],
          where: open,
          _count: { _all: true },
          _sum: { storyPoints: true },
        }),
        db.issue.groupBy({
          by: ['assigneeId'],
          where: { ...open, storyPoints: null },
          _count: { _all: true },
        }),
      ]);
      const ids = totals.map((t) => t.assigneeId).filter((id): id is string => id !== null);
      const [users, projectMembers, admins] = await Promise.all([
        db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        db.projectMember.findMany({
          where: { projectId: access.projectId, userId: { in: ids }, status: 'ACTIVE' },
          select: { userId: true },
        }),
        db.workspaceMember.findMany({
          where: {
            workspaceId: access.workspaceId,
            userId: { in: ids },
            status: 'ACTIVE',
            role: { in: ['OWNER', 'ADMIN'] },
          },
          select: { userId: true },
        }),
      ]);
      const names = new Map(users.map((u) => [u.id, u]));
      const active = new Set([...projectMembers, ...admins].map((m) => m.userId));
      const unest = new Map(unestimated.map((u) => [u.assigneeId, u._count._all]));
      const rows = totals
        .map((t) => ({
          assignee: t.assigneeId ? (names.get(t.assigneeId) ?? null) : null,
          activeMember: t.assigneeId === null || active.has(t.assigneeId),
          openIssues: t._count._all,
          points: t._sum.storyPoints ?? 0,
          unestimated: unest.get(t.assigneeId) ?? 0,
        }))
        // Assignees first by load, unassigned last.
        .sort((a, b) =>
          a.assignee === null
            ? 1
            : b.assignee === null
              ? -1
              : b.points - a.points || b.openIssues - a.openIssues,
        );
      return { range, archived: false, rows };
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
