import { ErrorState, Loading } from '../../components/page-state';
import { Card } from '../../components/ui/card';
import { useProjectOverview } from '../../lib/projects';
import { useProjectContext } from './project-layout';

const STATUS_ORDER = ['BACKLOG', 'TO_DO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
const STATUS_TEXT: Record<string, string> = {
  BACKLOG: 'Backlog',
  TO_DO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone === 'danger' && value !== 0 ? 'text-destructive' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

export function ProjectOverviewPage() {
  const { project } = useProjectContext();
  const overview = useProjectOverview(project.id);

  if (overview.isPending) return <Loading />;
  if (overview.isError) return <ErrorState error={overview.error} />;
  const o = overview.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Issues" value={o.totalIssues} />
        <Stat label="Overdue" value={o.overdueIssues} tone="danger" />
        <Stat label="Due in 7 days" value={o.upcomingIssues} />
        <Stat label="Project members" value={o.memberCount} />
      </div>
      <Card title="Progress">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {o.doneIssues} of {o.totalIssues} issues done
            </span>
            <span className="font-medium">{o.progressPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Issues done"
            aria-valuenow={o.progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${o.progressPercent}%` }}
            />
          </div>
        </div>
        {o.totalIssues === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No issues yet. Issue tracking arrives in the next release.
          </p>
        ) : (
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="rounded-md bg-slate-50 p-2">
                <dt className="text-muted">{STATUS_TEXT[s]}</dt>
                <dd className="font-semibold">{o.byStatus[s] ?? 0}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
      <Card title="Schedule">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Start</dt>
            <dd className="font-medium">{project.startDate ?? 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-muted">Target</dt>
            <dd className="font-medium">{project.targetDate ?? 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-muted">Active sprint</dt>
            <dd className="font-medium">
              {o.activeSprint
                ? `${o.activeSprint.name} (ends ${o.activeSprint.endAt.slice(0, 10)})`
                : 'None'}
            </dd>
          </div>
        </dl>
        {project.description && (
          <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{project.description}</p>
        )}
      </Card>
    </div>
  );
}
