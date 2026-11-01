import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES } from '@pm/shared';
import { BarList, RangeNote } from '../../components/charts';
import { ErrorState, Loading } from '../../components/page-state';
import { Card } from '../../components/ui/card';
import { useProjectOverview } from '../../lib/projects';
import { useVelocity, useWorkload } from '../../lib/reports';
import { SprintBurndown } from '../sprints/sprint-burndown';
import { useProjectContext } from './project-layout';

const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll('_', ' ');

/** FR-RPT-002…005: distributions, velocity, workload and the active sprint's burndown. */
export function ProjectReportsPage() {
  const { project } = useProjectContext();
  const overview = useProjectOverview(project.id);
  if (overview.isPending) return <Loading />;
  if (overview.isError) return <ErrorState error={overview.error} />;
  const o = overview.data;
  const dist = (keys: readonly string[], counts: Record<string, number>) =>
    keys.map((k) => ({ label: label(k), value: counts[k] ?? 0 }));

  return (
    <div className="space-y-6">
      <RangeNote range={o.range} />
      {o.totalIssues === 0 ? (
        <Card title="Issues">
          <p className="text-sm text-muted">No issues yet, so there is nothing to report.</p>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <Card title={`Status · ${o.progressPercent}% done`}>
            <BarList items={dist(ISSUE_STATUSES, o.byStatus)} />
          </Card>
          <Card title="Priority">
            <BarList items={dist(ISSUE_PRIORITIES, o.byPriority)} />
          </Card>
          <Card title="Type">
            <BarList items={dist(ISSUE_TYPES, o.byType)} />
          </Card>
        </div>
      )}
      {o.activeSprint && <SprintBurndown sid={o.activeSprint.id} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Velocity pid={project.id} />
        <Workload pid={project.id} />
      </div>
    </div>
  );
}

function Velocity({ pid }: { pid: string }) {
  const v = useVelocity(pid);
  return (
    <Card title="Velocity">
      {v.isPending ? (
        <Loading />
      ) : v.isError ? (
        <ErrorState error={v.error} />
      ) : v.data.sprints.length === 0 ? (
        <p className="text-sm text-muted">
          Complete a sprint to see velocity. Cancelled sprints never count.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Average <span className="font-semibold">{v.data.averageCompletedPoints} pt</span> over
            the last {v.data.sprints.length} completed sprint
            {v.data.sprints.length === 1 ? '' : 's'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Sprint</th>
                  <th className="py-1 pr-3 font-medium">Committed</th>
                  <th className="py-1 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {v.data.sprints.map((s) => {
                  const max = Math.max(
                    1,
                    ...v.data.sprints.map((x) => Math.max(x.committedPoints, x.completedPoints)),
                  );
                  return (
                    <tr key={s.id} className="border-t border-border align-top">
                      <td className="py-2 pr-3">
                        {s.name}
                        <span className="block text-xs text-muted">{s.closedAt.slice(0, 10)}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {s.committedPoints}
                        <div
                          className="mt-1 h-1.5 rounded-full bg-slate-300"
                          style={{ width: `${(s.committedPoints / max) * 100}%` }}
                          aria-hidden
                        />
                      </td>
                      <td className="py-2">
                        {s.completedPoints}
                        {s.unestimatedCompleted > 0 && (
                          <span className="ml-1 text-xs text-muted">
                            (+{s.unestimatedCompleted} unestimated)
                          </span>
                        )}
                        <div
                          className="mt-1 h-1.5 rounded-full bg-primary"
                          style={{ width: `${(s.completedPoints / max) * 100}%` }}
                          aria-hidden
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <RangeNote range={v.data.range} />
        </div>
      )}
    </Card>
  );
}

function Workload({ pid }: { pid: string }) {
  const w = useWorkload(pid);
  return (
    <Card title="Workload (open issues)">
      {w.isPending ? (
        <Loading />
      ) : w.isError ? (
        <ErrorState error={w.error} />
      ) : w.data.archived ? (
        <p className="text-sm text-muted">Archived projects have no open workload.</p>
      ) : w.data.rows.length === 0 ? (
        <p className="text-sm text-muted">No open issues.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Assignee</th>
                <th className="py-1 pr-3 font-medium">Issues</th>
                <th className="py-1 font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {w.data.rows.map((r) => (
                <tr key={r.assignee?.id ?? 'unassigned'} className="border-t border-border">
                  <td className="py-1 pr-3">
                    {r.assignee?.name ?? <span className="italic text-muted">Unassigned</span>}
                    {!r.activeMember && (
                      <span className="ml-1 text-xs text-amber-700">(no project access)</span>
                    )}
                  </td>
                  <td className="py-1 pr-3">{r.openIssues}</td>
                  <td className="py-1">
                    {r.points}
                    {r.unestimated > 0 && (
                      <span className="ml-1 text-xs text-muted">({r.unestimated} unestimated)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
