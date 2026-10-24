import type {
  BoardDto,
  CompleteSprintInput,
  CreateSprintInput,
  IssueDto,
  MoveIssueInput,
  RankIssueInput,
  SprintDetailDto,
  SprintDto,
  SprintIssuesInput,
  SprintReportDto,
  UpdateSprintInput,
} from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface BoardFilters {
  assignee: string;
  priority: string;
  type: string;
  labelId: string;
  search: string;
}
export const emptyBoardFilters: BoardFilters = {
  assignee: '',
  priority: '',
  type: '',
  labelId: '',
  search: '',
};

function query(f: BoardFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(f)) if (v.trim()) p.set(k, v.trim());
  return p.toString();
}

export const useBoard = (pid: string, f: BoardFilters, sprint: 'all' | 'active') =>
  useQuery({
    queryKey: ['issues', 'board', pid, f, sprint],
    queryFn: () =>
      api<BoardDto>(
        `/projects/${pid}/board?${query(f, sprint === 'active' ? { sprint: 'active' } : {})}`,
      ),
    placeholderData: (prev) => prev,
  });

export const useBacklog = (pid: string, f: BoardFilters) =>
  useQuery({
    queryKey: ['issues', 'backlog', pid, f],
    queryFn: async () =>
      (await api<{ issues: IssueDto[] }>(`/projects/${pid}/backlog?${query(f)}`)).issues,
    placeholderData: (prev) => prev,
  });

export const useSprints = (pid: string) =>
  useQuery({
    queryKey: ['sprints', pid],
    queryFn: async () => (await api<{ sprints: SprintDto[] }>(`/projects/${pid}/sprints`)).sprints,
  });

export const useSprint = (sid: string) =>
  useQuery({
    queryKey: ['sprints', 'detail', sid],
    queryFn: () => api<SprintDetailDto>(`/sprints/${sid}`),
  });

export const useSprintReport = (sid: string, enabled: boolean) =>
  useQuery({
    queryKey: ['sprints', 'report', sid],
    enabled,
    queryFn: () => api<SprintReportDto>(`/sprints/${sid}/report`),
  });

/** Views refresh only after the server confirms a change (no optimistic board state). */
function useBoardMutation<T, R = unknown>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['issues'] }),
        qc.invalidateQueries({ queryKey: ['sprints'] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  });
}

export const useMoveIssue = () =>
  useBoardMutation(({ id, body }: { id: string; body: MoveIssueInput }) =>
    api(`/issues/${id}/status`, { method: 'PATCH', body }),
  );
export const useRankIssue = () =>
  useBoardMutation(({ id, body }: { id: string; body: RankIssueInput }) =>
    api(`/issues/${id}/rank`, { method: 'PATCH', body }),
  );
export const useCreateSprint = (pid: string) =>
  useBoardMutation((body: CreateSprintInput) =>
    api<SprintDetailDto>(`/projects/${pid}/sprints`, { method: 'POST', body }),
  );
export const useUpdateSprint = (sid: string) =>
  useBoardMutation((body: UpdateSprintInput) => api(`/sprints/${sid}`, { method: 'PATCH', body }));
export const useSprintIssues = () =>
  useBoardMutation(({ sid, body }: { sid: string; body: Partial<SprintIssuesInput> }) =>
    api(`/sprints/${sid}/issues`, { method: 'PUT', body }),
  );
export const useSprintAction = (sid: string) =>
  useBoardMutation(
    ({ action, body }: { action: 'start' | 'cancel' | 'complete'; body?: CompleteSprintInput }) =>
      api<SprintDetailDto>(`/sprints/${sid}/${action}`, { method: 'POST', body }),
  );
