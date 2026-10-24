import type { ProjectDto } from '@pm/shared';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { ErrorState, Loading } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { ApiError } from '../../lib/api';
import { useProject } from '../../lib/projects';
import { ACCESS_LABEL, ProjectStatusBadge } from './project-status';

export interface ProjectContext {
  project: ProjectDto;
  wid: string;
}

export const useProjectContext = () => useOutletContext<ProjectContext>();

/** Loads the project once; the server re-resolves workspace ancestry on every call. */
export function ProjectLayout() {
  const { wid, pid } = useParams() as { wid: string; pid: string };
  const project = useProject(pid);

  if (project.isPending) return <Loading />;
  if (project.isError) return <ErrorState error={project.error} />;
  // A project id pasted under the wrong workspace URL is treated as not found.
  if (project.data.workspaceId !== wid)
    return (
      <ErrorState
        error={new ApiError(404, { code: 'NOT_FOUND', message: 'Not found', requestId: '' })}
      />
    );

  const p = project.data;
  const base = `/workspaces/${wid}/projects/${pid}`;
  const tabs = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/members`, label: 'Members', end: false },
    { to: `${base}/settings`, label: 'Settings', end: false },
  ];

  return (
    <>
      <div className="space-y-2">
        <Link to={`/workspaces/${wid}/projects`} className="text-sm text-muted hover:text-primary">
          ← Projects
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm">{p.key}</span>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <ProjectStatusBadge status={p.status} archived={p.archivedAt !== null} />
        </div>
        <p className="text-sm text-muted">Your access: {ACCESS_LABEL[p.myAccess] ?? p.myAccess}</p>
      </div>
      {p.archivedAt && (
        <Alert tone="info">
          This project is archived and read-only. Owners and Admins can unarchive it in Settings.
        </Alert>
      )}
      <nav aria-label="Project" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-slate-900'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ project: p, wid } satisfies ProjectContext} />
    </>
  );
}
