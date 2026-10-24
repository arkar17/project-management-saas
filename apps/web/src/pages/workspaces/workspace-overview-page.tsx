import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, Loading } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Badge, Card } from '../../components/ui/card';
import { lastWorkspace, useWorkspace } from '../../lib/workspaces';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

/** Dashboard foundation; project and sprint widgets arrive with G2-B/G4. */
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
      <Card title="Get started">
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
          <li>
            <Link className="text-primary" to={`/workspaces/${wid}/members`}>
              Review members{ws.myRole !== 'MEMBER' ? ' and invite your team' : ''}
            </Link>
          </li>
          <li>Projects, boards and sprints are coming in the next release.</li>
        </ul>
      </Card>
    </>
  );
}
