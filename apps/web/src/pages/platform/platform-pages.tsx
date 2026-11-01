import type { PlatformAuditEntryDto } from '@pm/shared';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Badge, Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import {
  usePlatformAudit,
  usePlatformMetrics,
  usePlatformUsers,
  usePlatformWorkspace,
  usePlatformWorkspaces,
  useWorkspaceStatus,
} from '../../lib/platform';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' }) {
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

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between text-sm">
      <button
        type="button"
        className="rounded px-2 py-1 text-primary disabled:opacity-40"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ← Previous
      </button>
      <span className="text-muted">
        Page {page} of {pages} · {total} total
      </span>
      <button
        type="button"
        className="rounded px-2 py-1 text-primary disabled:opacity-40"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-slate-50 text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

/** FR-ADM-004: aggregate metrics and job health only. */
export function PlatformDashboardPage() {
  const m = usePlatformMetrics();
  if (m.isPending) return <Loading />;
  if (m.isError) return <ErrorState error={m.error} />;
  const d = m.data;
  return (
    <>
      <h1 className="text-2xl font-semibold">Platform overview</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Workspaces" value={d.workspaces.total} />
        <Stat label="Suspended" value={d.workspaces.suspended} tone="danger" />
        <Stat label="Active members" value={d.activeMembers} />
        <Stat label="Users (active)" value={`${d.users.active} / ${d.users.total}`} />
      </div>
      <Card title="Background jobs">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Pending" value={d.jobs.pending} />
          <Stat label="Retrying" value={d.jobs.retrying} />
          <Stat label="Failed (dead)" value={d.jobs.dead} tone="danger" />
          <Stat label="Oldest pending" value={date(d.jobs.oldestPendingAt)} />
        </div>
      </Card>
    </>
  );
}

export function PlatformWorkspacesPage() {
  const [f, setF] = useState({ search: '', status: '', page: 1 });
  const list = usePlatformWorkspaces(f);
  return (
    <>
      <h1 className="text-2xl font-semibold">Workspaces</h1>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field
          label="Search name or slug"
          value={f.search}
          onChange={(e) => setF({ ...f, search: e.target.value, page: 1 })}
        />
        <SelectField
          label="Status"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}
        >
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </SelectField>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : list.data.workspaces.length === 0 ? (
        <EmptyState title="No workspaces match" />
      ) : (
        <>
          <Table head={['Workspace', 'Status', 'Owner', 'Members', 'Projects', 'Created']}>
            {list.data.workspaces.map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2">
                  <Link className="font-medium text-primary" to={`/platform/workspaces/${w.id}`}>
                    {w.name}
                  </Link>
                  <span className="block text-xs text-muted">{w.slug}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={w.status === 'SUSPENDED' ? 'warning' : 'neutral'}>
                    {w.status.toLowerCase()}
                  </Badge>
                </td>
                <td className="px-3 py-2">{w.owner?.name ?? '—'}</td>
                <td className="px-3 py-2">{w.activeMembers}</td>
                <td className="px-3 py-2">{w.projects}</td>
                <td className="px-3 py-2">{new Date(w.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </Table>
          <Pager {...list.data} onPage={(page) => setF({ ...f, page })} />
        </>
      )}
    </>
  );
}

/** FR-ADM-002: suspension and reactivation with a mandatory reason and explicit confirmation. */
export function PlatformWorkspaceDetailPage() {
  const wid = useParams().wid!;
  const detail = usePlatformWorkspace(wid);
  const change = useWorkspaceStatus(wid);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} />;
  const w = detail.data.workspace;
  const suspend = w.status === 'ACTIVE';
  const close = () => {
    setConfirming(false);
    setReason('');
  };
  return (
    <>
      <Link to="/platform/workspaces" className="text-sm text-muted hover:text-primary">
        ← Workspaces
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{w.name}</h1>
        <Badge tone={suspend ? 'neutral' : 'warning'}>{w.status.toLowerCase()}</Badge>
        <Button
          className={`ml-auto w-auto ${suspend ? 'bg-destructive' : ''}`}
          onClick={() => setConfirming(true)}
        >
          {suspend ? 'Suspend workspace…' : 'Reactivate workspace…'}
        </Button>
      </div>
      {change.isError && <Alert>{errorMessage(change.error)}</Alert>}
      <p className="text-sm text-muted">
        Metadata only. Issues, comments and files are never visible to platform administrators.
      </p>
      <Card title="Workspace">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {(
            [
              ['Slug', w.slug],
              ['Owner', w.owner?.name ?? '—'],
              ['Timezone', w.timezone],
              ['Active members', w.activeMembers],
              ['Projects (active / archived)', `${w.projects} / ${w.archivedProjects}`],
              ['Pending invitations', w.pendingInvitations],
              ['Created', date(w.createdAt)],
              ['Suspended since', date(w.suspendedAt)],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Status history">
        {detail.data.statusHistory.length === 0 ? (
          <p className="text-sm text-muted">Never suspended.</p>
        ) : (
          <AuditList entries={detail.data.statusHistory} />
        )}
      </Card>
      <ConfirmDialog
        open={confirming}
        title={suspend ? `Suspend ${w.name}?` : `Reactivate ${w.name}?`}
        confirmLabel={suspend ? 'Suspend' : 'Reactivate'}
        destructive={suspend}
        pending={change.isPending}
        onCancel={close}
        onConfirm={() => {
          if (reason.trim().length < 3) return;
          change.mutate({ suspend, reason }, { onSettled: close });
        }}
      >
        <p>
          {suspend
            ? 'Members keep read access but cannot change anything until the workspace is reactivated.'
            : 'Members regain full access.'}{' '}
          The reason is recorded in the audit log.
        </p>
        <Field
          label="Reason (required)"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>
    </>
  );
}

/** Read-only: the SRS defines no platform account actions. */
export function PlatformUsersPage() {
  const [f, setF] = useState({ search: '', status: '', page: 1 });
  const list = usePlatformUsers(f);
  return (
    <>
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Field
          label="Search name or email"
          value={f.search}
          onChange={(e) => setF({ ...f, search: e.target.value, page: 1 })}
        />
        <SelectField
          label="Status"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}
        >
          <option value="">All</option>
          <option value="ACTIVE">Active</option>
          <option value="DEACTIVATED">Deactivated</option>
        </SelectField>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : list.data.users.length === 0 ? (
        <EmptyState title="No users match" />
      ) : (
        <>
          <Table head={['User', 'Status', 'Verified', 'Workspaces', 'Joined']}>
            {list.data.users.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">
                  <span className="font-medium">{u.name}</span>
                  {u.platformAdmin && (
                    <span className="ml-2">
                      <Badge tone="primary">platform admin</Badge>
                    </span>
                  )}
                  <span className="block text-xs text-muted">{u.email}</span>
                </td>
                <td className="px-3 py-2">{u.status.toLowerCase()}</td>
                <td className="px-3 py-2">{u.emailVerified ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">{u.activeWorkspaces}</td>
                <td className="px-3 py-2">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </Table>
          <Pager {...list.data} onPage={(page) => setF({ ...f, page })} />
        </>
      )}
    </>
  );
}

function AuditList({ entries }: { entries: PlatformAuditEntryDto[] }) {
  return (
    <ul className="divide-y divide-border text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
          <time className="shrink-0 text-xs text-muted sm:w-44" dateTime={e.createdAt}>
            {date(e.createdAt)}
          </time>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{e.action}</span> by {e.actor?.name ?? 'system'}
            {e.actorType === 'PLATFORM_ADMIN' && ' (platform)'}
            {e.workspace && <> in {e.workspace.name}</>}
            {typeof e.metadata?.reason === 'string' && (
              <span className="block text-muted">Reason: {e.metadata.reason}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PlatformAuditPage() {
  const [f, setF] = useState({ action: '', actorType: '', page: 1 });
  const list = usePlatformAudit(f);
  return (
    <>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <Field
          label="Action starts with"
          placeholder="e.g. workspace."
          value={f.action}
          onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })}
        />
        <SelectField
          label="Actor"
          value={f.actorType}
          onChange={(e) => setF({ ...f, actorType: e.target.value, page: 1 })}
        >
          <option value="">Anyone</option>
          <option value="PLATFORM_ADMIN">Platform admins</option>
          <option value="USER">Workspace users</option>
          <option value="SYSTEM">System</option>
        </SelectField>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : list.data.entries.length === 0 ? (
        <EmptyState title="No audit entries match" />
      ) : (
        <Card>
          <AuditList entries={list.data.entries} />
          <div className="mt-3">
            <Pager {...list.data} onPage={(page) => setF({ ...f, page })} />
          </div>
        </Card>
      )}
    </>
  );
}
