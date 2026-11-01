import type { ProjectStatus } from '@pm/shared';
import { Badge } from '../../components/ui/card';

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
};

export function ProjectStatusBadge({
  status,
  archived,
}: {
  status: ProjectStatus;
  archived?: boolean;
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge tone={status === 'ACTIVE' ? 'primary' : status === 'ON_HOLD' ? 'warning' : 'neutral'}>
        {STATUS_LABEL[status]}
      </Badge>
      {archived && <Badge tone="warning">Archived</Badge>}
    </span>
  );
}

export const ACCESS_LABEL: Record<string, string> = {
  OWNER: 'Workspace owner',
  ADMIN: 'Workspace admin',
  PROJECT_MANAGER: 'Project manager',
  PROJECT_MEMBER: 'Member',
};
