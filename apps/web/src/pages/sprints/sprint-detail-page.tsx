import { updateSprintInput, type SprintDto } from '@pm/shared';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Field } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { canInProject } from '../../lib/permissions';
import {
  useSprint,
  useSprintAction,
  useSprintReport,
  useSprints,
  useUpdateSprint,
} from '../../lib/sprints';
import { StatusBadge } from '../issues/issue-meta';
import { useProjectContext } from '../projects/project-layout';
import { dayEnd, dayStart } from './sprint-form';
import { SprintStatusBadge, dateRange } from './sprint-status';

export function SprintDetailPage() {
  const sid = useParams().sid!;
  const { project, wid } = useProjectContext();
  const detail = useSprint(sid);
  const plan = canInProject(project.myAccess, 'manageSprintsAndBacklog') && !project.archivedAt;

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorState error={detail.error} />;
  const { sprint, issues } = detail.data;
  const done = issues.filter((i) => i.status === 'DONE');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          to={`/workspaces/${wid}/projects/${project.id}/sprints`}
          className="text-sm text-muted hover:text-primary"
        >
          ← Sprints
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{sprint.name}</h2>
          <SprintStatusBadge status={sprint.status} />
          <span className="text-sm text-muted">{dateRange(sprint)}</span>
        </div>
        {sprint.goal && <p className="text-sm text-slate-700">Goal: {sprint.goal}</p>}
        {sprint.status === 'ACTIVE' && (
          <Link
            to={`/workspaces/${wid}/projects/${project.id}/board?scope=active`}
            className="text-sm font-medium text-primary"
          >
            Open sprint board →
          </Link>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card title={`Issues (${issues.length}) · ${sprint.points} pt`}>
            {issues.length === 0 ? (
              <p className="text-sm text-muted">No issues. Add them from the Backlog tab.</p>
            ) : (
              <ul className="divide-y divide-border">
                {issues.map((i) => (
                  <li key={i.id}>
                    <Link
                      to={`/workspaces/${wid}/projects/${project.id}/issues/${i.id}`}
                      className="flex items-center gap-3 py-2 text-sm hover:text-primary"
                    >
                      <span className="font-mono text-muted">{i.key}</span>
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      {i.storyPoints !== null && (
                        <span className="text-xs text-muted">{i.storyPoints} pt</span>
                      )}
                      <StatusBadge status={i.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {(sprint.status === 'COMPLETED' || sprint.status === 'ACTIVE') && (
            <SprintReport sid={sid} />
          )}
        </div>
        <aside className="space-y-6">
          {plan && (sprint.status === 'PLANNED' || sprint.status === 'ACTIVE') && (
            <EditSprint key={sprint.endAt + sprint.name} sprint={sprint} />
          )}
          {plan && (
            <Lifecycle
              sprint={sprint}
              doneCount={done.length}
              unfinishedCount={issues.length - done.length}
              pid={project.id}
            />
          )}
          {sprint.status === 'CANCELLED' && (
            <Alert tone="info">
              This sprint was cancelled; its issues returned to the backlog.
            </Alert>
          )}
        </aside>
      </div>
    </div>
  );
}

/** FR-SPR-006: start date is editable only while PLANNED. */
function EditSprint({ sprint }: { sprint: SprintDto }) {
  const update = useUpdateSprint(sprint.id);
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? '');
  const [start, setStart] = useState(sprint.startAt.slice(0, 10));
  const [end, setEnd] = useState(sprint.endAt.slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    if (name !== sprint.name) changes.name = name;
    if (goal !== (sprint.goal ?? '')) changes.goal = goal || null;
    if (sprint.status === 'PLANNED' && start !== sprint.startAt.slice(0, 10))
      changes.startAt = dayStart(start);
    if (end !== sprint.endAt.slice(0, 10)) changes.endAt = dayEnd(end);
    const parsed = updateSprintInput.safeParse(changes);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid');
    setError(null);
    update.mutate(parsed.data);
  }

  return (
    <Card title="Edit sprint">
      <form className="space-y-3" onSubmit={onSubmit} noValidate>
        {(error || update.isError) && <Alert>{error ?? errorMessage(update.error)}</Alert>}
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Goal" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <Field
          label="Start"
          type="date"
          value={start}
          disabled={sprint.status !== 'PLANNED'}
          onChange={(e) => setStart(e.target.value)}
        />
        <Field label="End" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <Button type="submit" disabled={update.isPending}>
          Save
        </Button>
      </form>
    </Card>
  );
}

function Lifecycle({
  sprint,
  doneCount,
  unfinishedCount,
  pid,
}: {
  sprint: SprintDto;
  doneCount: number;
  unfinishedCount: number;
  pid: string;
}) {
  const action = useSprintAction(sprint.id);
  const sprints = useSprints(pid);
  const [dialog, setDialog] = useState<'cancel' | 'complete' | null>(null);
  const [destination, setDestination] = useState('backlog');
  const planned = sprints.data?.filter((s) => s.status === 'PLANNED' && s.id !== sprint.id) ?? [];
  const close = () => setDialog(null);

  if (sprint.status === 'COMPLETED')
    return <Alert tone="info">Completed sprints are read-only and cannot be reopened.</Alert>;
  if (sprint.status === 'CANCELLED') return null;

  return (
    <Card title="Sprint actions">
      {action.isError && <Alert>{errorMessage(action.error)}</Alert>}
      <div className="space-y-2">
        {sprint.status === 'PLANNED' && (
          <>
            <Button disabled={action.isPending} onClick={() => action.mutate({ action: 'start' })}>
              Start sprint
            </Button>
            <p className="text-xs text-muted">Starting freezes the committed story points.</p>
            <Button
              className="bg-white text-destructive ring-1 ring-border"
              onClick={() => setDialog('cancel')}
            >
              Cancel sprint…
            </Button>
          </>
        )}
        {sprint.status === 'ACTIVE' && (
          <Button onClick={() => setDialog('complete')}>Complete sprint…</Button>
        )}
      </div>
      <ConfirmDialog
        open={dialog === 'cancel'}
        title={`Cancel ${sprint.name}?`}
        confirmLabel="Cancel sprint"
        destructive
        pending={action.isPending}
        onCancel={close}
        onConfirm={() => action.mutate({ action: 'cancel' }, { onSettled: close })}
      >
        <p>
          Its issues return to the backlog with their status unchanged. The sprint is kept as
          cancelled and excluded from reports.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'complete'}
        title={`Complete ${sprint.name}?`}
        confirmLabel="Complete sprint"
        pending={action.isPending}
        onCancel={close}
        onConfirm={() =>
          action.mutate(
            {
              action: 'complete',
              body: {
                destination:
                  destination === 'backlog'
                    ? { type: 'backlog' }
                    : { type: 'sprint', sprintId: destination },
              },
            },
            { onSettled: close },
          )
        }
      >
        <p>
          {doneCount} done issue{doneCount === 1 ? '' : 's'} will be recorded as completed.{' '}
          {unfinishedCount} unfinished issue
          {unfinishedCount === 1 ? '' : 's'} must move:
        </p>
        <SelectField
          label="Move unfinished issues to"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        >
          <option value="backlog">Backlog</option>
          {planned.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (planned)
            </option>
          ))}
        </SelectField>
      </ConfirmDialog>
    </Card>
  );
}

function SprintReport({ sid }: { sid: string }) {
  const report = useSprintReport(sid, true);
  if (!report.data) return null;
  const r = report.data;
  const items: [string, string | number][] = [
    [
      'Committed',
      `${r.committedIssues} issues · ${r.committedPoints} pt` +
        (r.unestimatedCommitted > 0 ? ` (${r.unestimatedCommitted} unestimated)` : ''),
    ],
    ['Completed', `${r.completedIssues} issues · ${r.completedPoints} pt`],
    ['Added after start', r.addedAfterStart],
    ['Removed during sprint', r.removedDuringSprint],
    ['Carried over', r.carriedOver],
  ];
  return (
    <Card title={r.sprint.status === 'COMPLETED' ? 'Sprint summary' : 'Progress so far'}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md bg-slate-50 p-3">
            <dt className="text-muted">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
