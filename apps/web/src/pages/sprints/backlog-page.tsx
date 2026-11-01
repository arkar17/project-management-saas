import type { IssueDto, SprintDto } from '@pm/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { Card } from '../../components/ui/card';
import { canInProject } from '../../lib/permissions';
import {
  emptyBoardFilters,
  useBacklog,
  useRankIssue,
  useSprint,
  useSprintIssues,
  useSprints,
  type BoardFilters,
} from '../../lib/sprints';
import { BoardFilterBar } from '../board/board-filters';
import { PriorityText, StatusBadge } from '../issues/issue-meta';
import { useProjectContext } from '../projects/project-layout';
import { NewSprintForm } from './sprint-form';
import { SprintStatusBadge, dateRange } from './sprint-status';

const iconBtn = 'h-7 w-7 rounded border border-border text-xs disabled:opacity-40';

/** Backlog = issues in no sprint and not DONE, in rank order (ADR-016); PM+ plan sprints here. */
export function BacklogPage() {
  const { project, wid } = useProjectContext();
  const [filters, setFilters] = useState<BoardFilters>(emptyBoardFilters);
  const backlog = useBacklog(project.id, filters);
  const sprints = useSprints(project.id);
  const rank = useRankIssue();
  const membership = useSprintIssues();
  const plan = canInProject(project.myAccess, 'manageSprintsAndBacklog') && !project.archivedAt;
  const open = sprints.data?.filter((s) => s.status === 'PLANNED' || s.status === 'ACTIVE') ?? [];
  const busy = rank.isPending || membership.isPending;
  const issueHref = (i: IssueDto) => `/workspaces/${wid}/projects/${project.id}/issues/${i.id}`;

  function reorder(list: IssueDto[], index: number, direction: 'up' | 'down') {
    const issue = list[index]!;
    const afterId =
      direction === 'up' ? (index >= 2 ? list[index - 2]!.id : null) : list[index + 1]!.id;
    rank.mutate({ id: issue.id, body: { version: issue.version, scope: 'backlog', afterId } });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-4">
        <BoardFilterBar pid={project.id} value={filters} onChange={setFilters} />
        {(rank.error ?? membership.error) && (
          <Alert>{errorMessage(rank.error ?? membership.error)}</Alert>
        )}
        {backlog.isPending ? (
          <Loading />
        ) : backlog.isError ? (
          <ErrorState error={backlog.error} />
        ) : backlog.data.length === 0 ? (
          <EmptyState title="Backlog is empty">
            Issues that are not in a sprint and not done appear here.
          </EmptyState>
        ) : (
          <Card title={`Backlog (${backlog.data.length})`}>
            <ol className="divide-y divide-border">
              {backlog.data.map((i, idx) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                  {plan && (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Move ${i.key} up`}
                        className={iconBtn}
                        disabled={busy || idx === 0}
                        onClick={() => reorder(backlog.data, idx, 'up')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${i.key} down`}
                        className={iconBtn}
                        disabled={busy || idx === backlog.data.length - 1}
                        onClick={() => reorder(backlog.data, idx, 'down')}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                  <span className="w-20 font-mono text-sm text-muted">{i.key}</span>
                  <Link
                    to={issueHref(i)}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary"
                  >
                    {i.title}
                  </Link>
                  <PriorityText priority={i.priority} />
                  {i.storyPoints !== null && (
                    <span className="text-xs text-muted">{i.storyPoints} pt</span>
                  )}
                  <StatusBadge status={i.status} />
                  {plan && open.length > 0 && (
                    <>
                      <label htmlFor={`sprint-${i.id}`} className="sr-only">
                        Add {i.key} to sprint
                      </label>
                      <select
                        id={`sprint-${i.id}`}
                        value=""
                        disabled={busy}
                        onChange={(e) =>
                          e.target.value &&
                          membership.mutate({ sid: e.target.value, body: { add: [i.id] } })
                        }
                        className="h-8 rounded border border-border bg-white px-1 text-xs"
                      >
                        <option value="">Add to sprint…</option>
                        {open.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
      <aside className="space-y-4">
        {sprints.isError && <ErrorState error={sprints.error} />}
        {open.map((s) => (
          <OpenSprint key={s.id} sprint={s} plan={plan} wid={wid} pid={project.id} />
        ))}
        {sprints.data && open.length === 0 && (
          <p className="text-sm text-muted">No planned or active sprints.</p>
        )}
        {plan && <NewSprintForm pid={project.id} />}
      </aside>
    </div>
  );
}

function OpenSprint({
  sprint,
  plan,
  wid,
  pid,
}: {
  sprint: SprintDto;
  plan: boolean;
  wid: string;
  pid: string;
}) {
  const detail = useSprint(sprint.id);
  const membership = useSprintIssues();
  return (
    <Card
      title={sprint.name}
      actions={
        <Link
          to={`/workspaces/${wid}/projects/${pid}/sprints/${sprint.id}`}
          className="text-sm font-medium text-primary"
        >
          Open
        </Link>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <SprintStatusBadge status={sprint.status} />
        <span>{dateRange(sprint)}</span>
        <span>{sprint.points} pt</span>
      </div>
      {detail.data?.issues.length === 0 && (
        <p className="text-sm text-muted">No issues yet. Add some from the backlog.</p>
      )}
      <ul className="space-y-1">
        {detail.data?.issues.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted">{i.key}</span>
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            {plan && (
              <button
                type="button"
                aria-label={`Remove ${i.key} from ${sprint.name}`}
                disabled={membership.isPending}
                onClick={() => membership.mutate({ sid: sprint.id, body: { remove: [i.id] } })}
                className="rounded px-1 text-xs text-destructive hover:bg-red-50"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {sprint.status === 'ACTIVE' && plan && (
        <p className="mt-2 text-xs text-muted">
          Changes to an active sprint are recorded as scope changes.
        </p>
      )}
    </Card>
  );
}
