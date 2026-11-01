import type { Actor } from '@pm/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { useMe } from '../../lib/auth';
import {
  useActivity,
  useChildren,
  useDeleteIssue,
  useIssue,
  useLabels,
  useRestoreIssue,
  useSetIssueLabels,
  useWatch,
  useWatchers,
} from '../../lib/issues';
import { canInProject } from '../../lib/permissions';
import { useProjectContext } from '../projects/project-layout';
import { IssueAttachments } from './issue-attachments';
import { IssueComments } from './issue-comments';
import { IssueFieldsForm } from './issue-fields-form';
import { LabelChip, StatusBadge, TYPE_LABEL } from './issue-meta';
import { useAssignable } from './use-assignable';

const FIELD_TEXT: Record<string, string> = {
  created: 'created the issue',
  deleted: 'deleted the issue',
  restored: 'restored the issue',
  description: 'edited the description',
  labels: 'changed labels',
  assigneeId: 'changed the assignee',
  parentId: 'changed the parent',
  dueAt: 'changed the due date',
  storyPoints: 'changed story points',
  attachment: 'attached',
};

export function IssueDetailPage() {
  const iid = useParams().iid!;
  const { project, wid } = useProjectContext();
  const issue = useIssue(iid);
  const { data: me } = useMe();
  const assignable = useAssignable(wid, project.id);

  if (issue.isPending) return <Loading />;
  if (issue.isError) return <ErrorState error={issue.error} />;
  const i = issue.data;
  const access = project.myAccess as Actor;
  const readOnly = project.archivedAt !== null || i.deletedAt !== null;
  const isOwn = i.reporter.id === me?.id || i.assignee?.id === me?.id;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          to={`/workspaces/${wid}/projects/${project.id}/issues`}
          className="text-sm text-muted hover:text-primary"
        >
          ← Issues
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm text-muted">{i.key}</span>
          <span className="text-sm text-muted">{TYPE_LABEL[i.type]}</span>
          <StatusBadge status={i.status} />
        </div>
        <h2 className="text-xl font-semibold">{i.title}</h2>
        {i.parent && (
          <p className="text-sm text-muted">
            Part of{' '}
            <Link
              className="text-primary"
              to={`/workspaces/${wid}/projects/${project.id}/issues/${i.parent.id}`}
            >
              {i.parent.key} · {i.parent.title}
            </Link>
          </p>
        )}
        <p className="text-sm text-muted">
          Reported by {i.reporter.name} · {new Date(i.createdAt).toLocaleDateString()}
        </p>
      </div>
      {i.deletedAt && <Alert tone="info">This issue is deleted and hidden from members.</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          <IssueFieldsForm
            key={i.version}
            issue={i}
            access={access}
            isOwn={isOwn}
            readOnly={readOnly}
            assignable={assignable}
          />
          <Children iid={i.id} wid={wid} pid={project.id} />
          <IssueAttachments
            issueId={i.id}
            canUpload={!readOnly && canInProject(access, 'commentAndAttach')}
          />
          <IssueComments
            issueId={i.id}
            canComment={!readOnly && canInProject(access, 'commentAndAttach')}
            canModerate={!readOnly && canInProject(access, 'moderateComments')}
          />
          <Activity iid={i.id} />
        </div>
        <aside className="space-y-6">
          <Labels
            iid={i.id}
            pid={project.id}
            current={i.labels.map((l) => l.id)}
            editable={!readOnly && canInProject(access, 'manageLabels')}
          />
          <Watchers iid={i.id} canWatch={!readOnly} />
          {canInProject(access, 'softDeleteRestoreIssue') && !project.archivedAt && (
            <DeleteRestore iid={i.id} deleted={i.deletedAt !== null} issueKey={i.key} />
          )}
        </aside>
      </div>
    </div>
  );
}

function Children({ iid, wid, pid }: { iid: string; wid: string; pid: string }) {
  const children = useChildren(iid);
  if (!children.data || children.data.length === 0) return null;
  return (
    <Card title={`Child issues (${children.data.length})`}>
      <ul className="divide-y divide-border">
        {children.data.map((c) => (
          <li key={c.id}>
            <Link
              to={`/workspaces/${wid}/projects/${pid}/issues/${c.id}`}
              className="flex items-center gap-3 py-2 text-sm hover:text-primary"
            >
              <span className="font-mono text-muted">{c.key}</span>
              <span className="flex-1 truncate">{c.title}</span>
              <StatusBadge status={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Labels({
  iid,
  pid,
  current,
  editable,
}: {
  iid: string;
  pid: string;
  current: string[];
  editable: boolean;
}) {
  const labels = useLabels(pid);
  const setLabels = useSetIssueLabels(iid);
  const selected = new Set(current);
  const all = labels.data ?? [];
  return (
    <Card title="Labels">
      {setLabels.isError && <Alert>{errorMessage(setLabels.error)}</Alert>}
      {all.length === 0 ? (
        <p className="text-sm text-muted">No labels in this project.</p>
      ) : editable ? (
        <div className="space-y-1.5">
          {all.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                disabled={setLabels.isPending}
                onChange={(e) =>
                  setLabels.mutate(
                    e.target.checked ? [...current, l.id] : current.filter((x) => x !== l.id),
                  )
                }
              />
              <LabelChip {...l} />
            </label>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {all
            .filter((l) => selected.has(l.id))
            .map((l) => (
              <LabelChip key={l.id} {...l} />
            ))}
          {current.length === 0 && <p className="text-sm text-muted">None</p>}
        </div>
      )}
    </Card>
  );
}

function Watchers({ iid, canWatch }: { iid: string; canWatch: boolean }) {
  const watchers = useWatchers(iid);
  const watch = useWatch(iid);
  if (!watchers.data) return null;
  return (
    <Card title={`Watchers (${watchers.data.watchers.length})`}>
      <p className="text-sm text-muted">
        {watchers.data.watchers.map((w) => w.name).join(', ') || 'Nobody yet'}
      </p>
      {canWatch && (
        <Button
          className="mt-3 bg-white text-slate-900 ring-1 ring-border"
          disabled={watch.isPending}
          onClick={() => watch.mutate(!watchers.data.watching)}
        >
          {watchers.data.watching ? 'Stop watching' : 'Watch'}
        </Button>
      )}
    </Card>
  );
}

function Activity({ iid }: { iid: string }) {
  const activity = useActivity(iid);
  if (!activity.data) return null;
  return (
    <Card title="Activity">
      <ol className="space-y-2 text-sm">
        {activity.data.map((a) => (
          <li key={a.id} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{a.actor.name}</span>
            <span>
              {FIELD_TEXT[a.field] ?? `changed ${a.field}`}
              {['status', 'priority', 'type', 'title'].includes(a.field) && a.newValue
                ? ` to ${a.newValue.replaceAll('_', ' ').toLowerCase()}`
                : ''}
              {a.field === 'labels' ? `: ${a.newValue ?? 'none'}` : ''}
              {a.field === 'attachment' && a.newValue ? ` ${a.newValue}` : ''}
            </span>
            <time className="text-muted" dateTime={a.createdAt}>
              {new Date(a.createdAt).toLocaleString()}
            </time>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function DeleteRestore({
  iid,
  deleted,
  issueKey,
}: {
  iid: string;
  deleted: boolean;
  issueKey: string;
}) {
  const del = useDeleteIssue(iid);
  const restore = useRestoreIssue(iid);
  const [confirming, setConfirming] = useState(false);
  const error = del.error ?? restore.error;
  return (
    <Card title={deleted ? 'Restore' : 'Delete'}>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {deleted ? (
        <Button disabled={restore.isPending} onClick={() => restore.mutate(undefined)}>
          Restore to backlog
        </Button>
      ) : (
        <Button className="bg-destructive" onClick={() => setConfirming(true)}>
          Delete issue…
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Delete ${issueKey}?`}
        confirmLabel="Delete"
        destructive
        pending={del.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => del.mutate(undefined, { onSettled: () => setConfirming(false) })}
      >
        <p>
          The issue is hidden from members and removed from any open sprint. Project managers can
          restore it later.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
