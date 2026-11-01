import { Link, Navigate } from 'react-router-dom';
import { EmptyState, ErrorState, Loading } from '../../components/page-state';
import { Badge, Card } from '../../components/ui/card';
import { useMe } from '../../lib/auth';
import { lastWorkspace, useWorkspaces } from '../../lib/workspaces';

export function WorkspaceIndexPage() {
  const { data: user } = useMe();
  const workspaces = useWorkspaces();

  if (user && !user.emailVerified) {
    return (
      <EmptyState title="Verify your email to get started">
        Check your inbox for the link.
      </EmptyState>
    );
  }
  if (workspaces.isPending) return <Loading />;
  if (workspaces.isError) return <ErrorState error={workspaces.error} />;

  const last = lastWorkspace.get();
  if (last && workspaces.data.some((w) => w.id === last)) {
    return <Navigate to={`/workspaces/${last}`} replace />;
  }
  if (workspaces.data.length === 0) {
    return (
      <EmptyState title="No workspaces yet">
        <p>Create a workspace for your team, or ask an admin to invite you.</p>
        <Link
          to="/workspaces/new"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground"
        >
          Create workspace
        </Link>
      </EmptyState>
    );
  }
  return (
    <Card
      title="Your workspaces"
      actions={
        <Link to="/workspaces/new" className="text-sm font-medium text-primary">
          + New workspace
        </Link>
      }
    >
      <ul className="divide-y divide-border">
        {workspaces.data.map((w) => (
          <li key={w.id}>
            <Link
              to={`/workspaces/${w.id}`}
              onClick={() => lastWorkspace.set(w.id)}
              className="flex items-center justify-between gap-3 py-3 hover:text-primary"
            >
              <span className="font-medium">{w.name}</span>
              <span className="flex gap-2">
                {w.status === 'SUSPENDED' && <Badge tone="warning">Suspended</Badge>}
                <Badge>{w.myRole.toLowerCase()}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
