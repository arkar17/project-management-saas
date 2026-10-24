import type { SprintStatus } from '@pm/shared';
import { Badge } from '../../components/ui/card';

const TEXT: Record<SprintStatus, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function SprintStatusBadge({ status }: { status: SprintStatus }) {
  return (
    <Badge tone={status === 'ACTIVE' ? 'primary' : status === 'PLANNED' ? 'warning' : 'neutral'}>
      {TEXT[status]}
    </Badge>
  );
}

export const dateRange = (s: { startAt: string; endAt: string }) =>
  `${new Date(s.startAt).toLocaleDateString()} – ${new Date(s.endAt).toLocaleDateString()}`;
