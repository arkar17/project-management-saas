import { PROJECT_STATUSES } from '@pm/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../../components/page-state';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { canInWorkspace } from '../../lib/permissions';
import { useProjects, type ProjectFilters } from '../../lib/projects';
import { useWorkspace } from '../../lib/workspaces';
import { ProjectStatusBadge, STATUS_LABEL } from './project-status';

export function ProjectListPage() {
  const wid = useParams().wid!;
  const workspace = useWorkspace(wid);
  const [filters, setFilters] = useState<ProjectFilters>({
    search: '',
    status: '',
    archived: 'active',
  });
  const projects = useProjects(wid, filters);
  const canCreate =
    canInWorkspace(workspace.data?.myRole, 'manageProjectLifecycle') &&
    workspace.data?.status === 'ACTIVE';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Projects</h1>
        {canCreate && (
          <Link
            to={`/workspaces/${wid}/projects/new`}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            New project
          </Link>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
        <Field
          label="Search"
          type="search"
          placeholder="Name or key"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <SelectField
          label="Status"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Show"
          value={filters.archived}
          onChange={(e) =>
            setFilters({ ...filters, archived: e.target.value as ProjectFilters['archived'] })
          }
        >
          <option value="active">Active projects</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </SelectField>
      </div>
      {projects.isPending ? (
        <Loading />
      ) : projects.isError ? (
        <ErrorState error={projects.error} />
      ) : projects.data.projects.length === 0 ? (
        <EmptyState
          title={filters.search || filters.status ? 'No matching projects' : 'No projects yet'}
        >
          {canCreate ? (
            <p>Create the first project for this workspace.</p>
          ) : (
            <p>Projects appear here once a project manager adds you.</p>
          )}
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {projects.data.projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/workspaces/${wid}/projects/${p.id}`}
                  className="flex flex-wrap items-center gap-3 py-3 hover:text-primary"
                >
                  <span className="w-16 shrink-0 font-mono text-sm text-muted">{p.key}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  {p.targetDate && (
                    <span className="text-sm text-muted">Target {p.targetDate}</span>
                  )}
                  <ProjectStatusBadge status={p.status} archived={p.archivedAt !== null} />
                </Link>
              </li>
            ))}
          </ul>
          {projects.data.total > projects.data.projects.length && (
            <p className="pt-3 text-sm text-muted">
              Showing {projects.data.projects.length} of {projects.data.total}. Refine the search to
              narrow results.
            </p>
          )}
        </Card>
      )}
    </>
  );
}
