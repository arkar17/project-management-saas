import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../../components/page-state';
import { Card } from '../../components/ui/card';
import { canInProject } from '../../lib/permissions';
import { useSprints } from '../../lib/sprints';
import { useProjectContext } from '../projects/project-layout';
import { NewSprintForm } from './sprint-form';
import { SprintStatusBadge, dateRange } from './sprint-status';

const ORDER = ['ACTIVE', 'PLANNED', 'COMPLETED', 'CANCELLED'] as const;
const HEADING = {
  ACTIVE: 'Active',
  PLANNED: 'Planned',
  COMPLETED: 'History',
  CANCELLED: 'Cancelled',
} as const;

export function SprintsPage() {
  const { project, wid } = useProjectContext();
  const sprints = useSprints(project.id);
  const plan = canInProject(project.myAccess, 'manageSprintsAndBacklog') && !project.archivedAt;
  if (sprints.isPending) return <Loading />;
  if (sprints.isError) return <ErrorState error={sprints.error} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {sprints.data.length === 0 && (
          <EmptyState title="No sprints yet">
            {plan
              ? 'Create a sprint, then add backlog issues to it.'
              : 'A project manager plans sprints.'}
          </EmptyState>
        )}
        {ORDER.map((status) => {
          const group = sprints.data.filter((s) => s.status === status);
          if (group.length === 0) return null;
          return (
            <Card key={status} title={HEADING[status]}>
              <ul className="divide-y divide-border">
                {group.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/workspaces/${wid}/projects/${project.id}/sprints/${s.id}`}
                      className="flex flex-wrap items-center gap-3 py-3 hover:text-primary"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      <span className="text-sm text-muted">{dateRange(s)}</span>
                      <span className="text-sm text-muted">
                        {s.issueCount} issues · {s.points} pt
                      </span>
                      <SprintStatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      {plan && (
        <aside>
          <NewSprintForm pid={project.id} />
        </aside>
      )}
    </div>
  );
}
