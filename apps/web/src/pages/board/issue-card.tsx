import { ISSUE_STATUSES, type IssueDto, type IssueStatus } from '@pm/shared';
import { Link } from 'react-router-dom';
import { LabelChip, PriorityText, STATUS_LABEL, TYPE_LABEL } from '../issues/issue-meta';

interface IssueCardProps {
  issue: IssueDto;
  href: string;
  canMove: boolean;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (status: IssueStatus) => void;
  onReorder: (direction: 'up' | 'down') => void;
  onDragStart: () => void;
}

/**
 * Board card. Drag-and-drop is a pointer convenience; the "Move to" select and the
 * up/down buttons are the keyboard/touch path (FR-BRD-004, TC-BRD-004-1).
 */
export function IssueCard({
  issue,
  href,
  canMove,
  canReorder,
  isFirst,
  isLast,
  busy,
  onMove,
  onReorder,
  onDragStart,
}: IssueCardProps) {
  return (
    <article
      draggable={canMove && !busy}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', issue.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      className={`space-y-2 rounded-lg border border-border bg-white p-3 shadow-sm ${canMove ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="font-mono">{issue.key}</span>
        <span>{TYPE_LABEL[issue.type]}</span>
        <span className="ml-auto">
          <PriorityText priority={issue.priority} />
        </span>
      </div>
      <Link to={href} className="block text-sm font-medium hover:text-primary">
        {issue.title}
      </Link>
      {issue.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {issue.labels.map((l) => (
            <LabelChip key={l.id} {...l} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="truncate">{issue.assignee?.name ?? 'Unassigned'}</span>
        {issue.storyPoints !== null && (
          <span className="ml-auto rounded bg-slate-100 px-1.5">{issue.storyPoints} pt</span>
        )}
      </div>
      {canMove && (
        <div className="flex items-center gap-1">
          <label className="sr-only" htmlFor={`move-${issue.id}`}>
            Move {issue.key} to
          </label>
          <select
            id={`move-${issue.id}`}
            className="h-7 min-w-0 flex-1 rounded border border-border bg-white px-1 text-xs"
            value={issue.status}
            disabled={busy}
            onChange={(e) => onMove(e.target.value as IssueStatus)}
          >
            {ISSUE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {canReorder && (
            <>
              <button
                type="button"
                aria-label={`Move ${issue.key} up`}
                disabled={busy || isFirst}
                onClick={() => onReorder('up')}
                className="h-7 w-7 rounded border border-border text-xs disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${issue.key} down`}
                disabled={busy || isLast}
                onClick={() => onReorder('down')}
                className="h-7 w-7 rounded border border-border text-xs disabled:opacity-40"
              >
                ↓
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
