import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Badge, Card } from '../../components/ui/card';
import { ISSUE_STATUSES } from '@pm/shared';
import { BarList, RangeNote } from '../../components/charts';
import { useWorkspaceOverview } from '../../lib/reports';
import { lastWorkspace, useWorkspace } from '../../lib/workspaces';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export function WorkspaceOverviewPage() {
  const wid = useParams().wid!;
  const workspace = useWorkspace(wid);
  useEffect(() => {
    if (workspace.data) lastWorkspace.set(wid);
  }, [workspace.data, wid]);

  if (workspace.isPending) return <Loading />;
  if (workspace.isError) return <ErrorState error={workspace.error} />;
  const ws = workspace.data;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{ws.name}</h1>
        <Badge tone="primary">{ws.myRole.toLowerCase()}</Badge>
        {ws.status === 'SUSPENDED' && <Badge tone="warning">Suspended</Badge>}
      </div>
      {ws.status === 'SUSPENDED' && (
        <Alert>This workspace is suspended by the platform administrator. It is read-only.</Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Members" value={ws.memberCount} />
        <Stat
          label={ws.myRole === 'MEMBER' ? 'Your projects' : 'Projects'}
          value={ws.projectCount}
        />
        <Stat label="Reporting timezone" value={ws.timezone.replaceAll('_', ' ')} />
      </div>
      <WorkspaceDashboard wid={wid} />
    </>
  );
}

const statusLabel = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll('_', ' ');

/** FR-RPT-001: summary of the projects the caller can read, in the workspace timezone. */
function WorkspaceDashboard({ wid }: { wid: string }) {
  const overview = useWorkspaceOverview(wid);
  if (overview.isPending) return <Loading label="Loading dashboard…" />;
  if (overview.isError) return <ErrorState error={overview.error} />;
  const o = overview.data;
  if (o.projects.length === 0) {
    return (
      <EmptyState title="No projects to report on">
        <p>
          <Link className="text-primary" to={`/workspaces/${wid}/projects`}>
            Open projects
          </Link>{' '}
          to create one or ask to be added.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open issues" value={o.totals.open} />
        <Stat label="Completed" value={o.totals.done} />
        <Stat label="Overdue" value={o.totals.overdue} />
        <Stat label="Due in 7 days" value={o.totals.upcoming} />
      </div>
      <RangeNote range={o.range} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Projects">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Project</th>
                  <th className="py-1 pr-3 font-medium">Open</th>
                  <th className="py-1 pr-3 font-medium">Overdue</th>
                  <th className="py-1 font-medium">Done</th>
                </tr>
              </thead>
              <tbody>
                {o.projects.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 pr-3">
                      <Link
                        className="font-medium text-primary"
                        to={`/workspaces/${wid}/projects/${p.id}/reports`}
                      >
                        {p.name}
                      </Link>
                      <span className="ml-1 font-mono text-xs text-muted">{p.key}</span>
                    </td>
                    <td className="py-2 pr-3">{p.open}</td>
                    <td
                      className={`py-2 pr-3 ${p.overdue > 0 ? 'font-medium text-destructive' : ''}`}
                    >
                      {p.overdue}
                    </td>
                    <td className="py-2">{p.progressPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="By status">
          <BarList
            items={ISSUE_STATUSES.map((s) => ({
              label: statusLabel(s),
              value: o.byStatus[s] ?? 0,
            }))}
          />
        </Card>
      </div>
      <Card title="Upcoming due dates">
        {o.upcoming.length === 0 ? (
          <p className="text-sm text-muted">Nothing due in the next 7 days.</p>
        ) : (
          <ul className="divide-y divide-border">
            {o.upcoming.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
              >
                <Link
                  className="min-w-0 flex-1 truncate hover:text-primary"
                  to={`/workspaces/${wid}/projects/${i.projectId}/issues/${i.id}`}
                >
                  <span className="font-mono text-muted">{i.key}</span> {i.title}
                </Link>
                <span className="text-xs text-muted">
                  {i.assignee?.name ?? 'Unassigned'} · due {new Date(i.dueAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
