import type { IssueDto, IssueStatus } from '@pm/shared';
import { useState } from 'react';
import { EmptyState, ErrorState, Loading, errorMessage } from '../../components/page-state';
import { Alert } from '../../components/ui/alert';
import { useMe } from '../../lib/auth';
import { canInProject } from '../../lib/permissions';
import {
  emptyBoardFilters,
  useBoard,
  useMoveIssue,
  useRankIssue,
  type BoardFilters,
} from '../../lib/sprints';
import { STATUS_LABEL } from '../issues/issue-meta';
import { useProjectContext } from '../projects/project-layout';
import { BoardFilterBar } from './board-filters';
import { IssueCard } from './issue-card';

/**
 * Kanban board (FR-BRD-001…004). PM+ move and reorder anything; Members move their own
 * issues between columns and the server appends them to the end. The board refetches after
 * each confirmed mutation; a 409 means it was stale and is reloaded.
 */
export function BoardPage({ initialScope = 'all' }: { initialScope?: 'all' | 'active' }) {
  const { project, wid } = useProjectContext();
  const { data: me } = useMe();
  const [filters, setFilters] = useState<BoardFilters>(emptyBoardFilters);
  const [scope, setScope] = useState<'all' | 'active'>(initialScope);
  const board = useBoard(project.id, filters, scope);
  const move = useMoveIssue();
  const rank = useRankIssue();
  const [dragging, setDragging] = useState<IssueDto | null>(null);
  const writable = !project.archivedAt;
  const reorder = writable && canInProject(project.myAccess, 'reorderRanking');
  const busy = move.isPending || rank.isPending;
  const error = move.error ?? rank.error;

  const canMove = (i: IssueDto) =>
    writable &&
    (canInProject(project.myAccess, 'editAnyIssue') ||
      canInProject(project.myAccess, 'changeOwnIssueStatus', {
        isOwn: i.reporter.id === me?.id || i.assignee?.id === me?.id,
      }));

  /** afterId is only sent when the caller may position; Members always append. */
  function moveTo(issue: IssueDto, status: IssueStatus, afterId?: string | null) {
    move.mutate({
      id: issue.id,
      body: {
        version: issue.version,
        status,
        ...(reorder && afterId !== undefined ? { afterId } : {}),
      },
    });
  }

  function reorderWithin(column: IssueDto[], index: number, direction: 'up' | 'down') {
    const issue = column[index]!;
    const afterId =
      direction === 'up' ? (index >= 2 ? column[index - 2]!.id : null) : column[index + 1]!.id;
    rank.mutate({ id: issue.id, body: { version: issue.version, scope: 'board', afterId } });
  }

  /** Dropping on a card places the dragged issue before it; on the column, at the end. */
  function onDrop(status: IssueStatus, column: IssueDto[], beforeIndex: number | null) {
    const dragged = dragging;
    setDragging(null);
    if (!dragged) return;
    const target = beforeIndex === null ? null : column[beforeIndex]!;
    if (target?.id === dragged.id) return;
    const others = column.filter((i) => i.id !== dragged.id);
    const insertAt = target ? others.findIndex((i) => i.id === target.id) : others.length;
    const afterId = insertAt === 0 ? null : others[insertAt - 1]!.id;
    if (dragged.status === status && !reorder) return; // Members cannot reorder
    moveTo(dragged, status, afterId);
  }

  if (board.isPending) return <Loading />;
  if (board.isError) return <ErrorState error={board.error} />;
  const empty = board.data.columns.every((c) => c.issues.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Board scope">
        {(['all', 'active'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${scope === s ? 'bg-primary text-primary-foreground' : 'bg-white ring-1 ring-border'}`}
          >
            {s === 'all' ? 'All issues' : 'Active sprint'}
          </button>
        ))}
        {scope === 'active' && board.data.sprint && (
          <span className="text-sm text-muted">
            {board.data.sprint.name} · ends {new Date(board.data.sprint.endAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <BoardFilterBar pid={project.id} value={filters} onChange={setFilters} />
      {error && <Alert>{errorMessage(error)}</Alert>}
      {!reorder && writable && (
        <p className="text-sm text-muted">
          You can move issues you reported or are assigned to. Moved issues go to the end of the
          column.
        </p>
      )}
      {scope === 'active' && !board.data.sprint ? (
        <EmptyState title="No active sprint">
          Start a sprint from the Sprints tab to see its board.
        </EmptyState>
      ) : empty ? (
        <EmptyState title="Nothing on the board">Create issues or adjust the filters.</EmptyState>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="grid min-w-[56rem] grid-cols-5 gap-3">
            {board.data.columns.map((col) => (
              <section
                key={col.status}
                aria-label={`${STATUS_LABEL[col.status]} column`}
                onDragOver={(e) => dragging && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(col.status, col.issues, null);
                }}
                className={`flex min-h-48 flex-col gap-2 rounded-xl bg-slate-100 p-2 ${dragging ? 'ring-1 ring-dashed ring-primary/40' : ''}`}
              >
                <h3 className="flex items-center justify-between px-1 text-sm font-semibold">
                  {STATUS_LABEL[col.status]}
                  <span className="text-xs font-normal text-muted">{col.issues.length}</span>
                </h3>
                {col.issues.map((issue, i) => (
                  <div
                    key={issue.id}
                    onDragOver={(e) => dragging && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDrop(col.status, col.issues, i);
                    }}
                  >
                    <IssueCard
                      issue={issue}
                      href={`/workspaces/${wid}/projects/${project.id}/issues/${issue.id}`}
                      canMove={canMove(issue)}
                      canReorder={reorder}
                      isFirst={i === 0}
                      isLast={i === col.issues.length - 1}
                      busy={busy}
                      onMove={(status) => moveTo(issue, status)}
                      onReorder={(d) => reorderWithin(col.issues, i, d)}
                      onDragStart={() => setDragging(issue)}
                    />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
