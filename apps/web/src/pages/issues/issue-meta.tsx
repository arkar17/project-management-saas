import type { IssuePriority, IssueStatus, IssueType } from '@pm/shared';
import { Badge } from '../../components/ui/card';

export const TYPE_LABEL: Record<IssueType, string> = {
  EPIC: 'Epic',
  STORY: 'Story',
  TASK: 'Task',
  BUG: 'Bug',
  SUBTASK: 'Subtask',
};
export const STATUS_LABEL: Record<IssueStatus, string> = {
  BACKLOG: 'Backlog',
  TO_DO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
};
export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  LOWEST: 'Lowest',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  HIGHEST: 'Highest',
};

export function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge
      tone={
        status === 'DONE'
          ? 'neutral'
          : status === 'IN_PROGRESS' || status === 'IN_REVIEW'
            ? 'primary'
            : 'neutral'
      }
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityText({ priority }: { priority: IssuePriority }) {
  const tone = priority === 'HIGHEST' || priority === 'HIGH' ? 'text-destructive' : 'text-muted';
  return <span className={`text-xs font-medium ${tone}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}
