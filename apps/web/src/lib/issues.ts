import type {
  ActivityDto,
  CommentDto,
  CreateIssueInput,
  IssueDto,
  IssueListDto,
  LabelDto,
  UpdateIssueInput,
  WatchersDto,
} from '@pm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface IssueFilters {
  search: string;
  type: string;
  status: string;
  priority: string;
  assignee: string;
  labelId: string;
  deleted: boolean;
}

export const emptyIssueFilters: IssueFilters = {
  search: '',
  type: '',
  status: '',
  priority: '',
  assignee: '',
  labelId: '',
  deleted: false,
};

export const issueKeys = {
  all: ['issues'] as const,
  list: (pid: string, f: unknown) => ['issues', 'list', pid, f] as const,
  detail: (iid: string) => ['issues', iid] as const,
  labels: (pid: string) => ['issues', 'labels', pid] as const,
};

export function useIssues(pid: string, f: IssueFilters, pageSize = 50) {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  for (const k of ['search', 'type', 'status', 'priority', 'assignee', 'labelId'] as const) {
    if (f[k].trim()) params.set(k, f[k].trim());
  }
  if (f.deleted) params.set('deleted', 'true');
  return useQuery({
    queryKey: issueKeys.list(pid, f),
    queryFn: () => api<IssueListDto>(`/projects/${pid}/issues?${params}`),
    placeholderData: (prev) => prev,
  });
}

export const useIssue = (iid: string) =>
  useQuery({
    queryKey: issueKeys.detail(iid),
    queryFn: async () => (await api<{ issue: IssueDto }>(`/issues/${iid}`)).issue,
  });

function useIssuePart<T>(iid: string, part: string, pick: (body: never) => T) {
  return useQuery({
    queryKey: [...issueKeys.detail(iid), part],
    queryFn: async () => pick(await api<never>(`/issues/${iid}/${part}`)),
  });
}

export const useChildren = (iid: string) =>
  useIssuePart(iid, 'children', (r: { issues: IssueDto[] }) => r.issues);
export const useComments = (iid: string) =>
  useIssuePart(iid, 'comments', (r: { comments: CommentDto[] }) => r.comments);
export const useActivity = (iid: string) =>
  useIssuePart(iid, 'activity', (r: { activity: ActivityDto[] }) => r.activity);
export const useWatchers = (iid: string) => useIssuePart(iid, 'watchers', (r: WatchersDto) => r);

export const useLabels = (pid: string) =>
  useQuery({
    queryKey: issueKeys.labels(pid),
    queryFn: async () => (await api<{ labels: LabelDto[] }>(`/projects/${pid}/labels`)).labels,
  });

/** Issue changes can affect lists, details, children and the project overview. */
function useIssueMutation<T, R = unknown>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: issueKeys.all }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  });
}

export const useCreateIssue = (pid: string) =>
  useIssueMutation(
    async (input: CreateIssueInput) =>
      (await api<{ issue: IssueDto }>(`/projects/${pid}/issues`, { method: 'POST', body: input }))
        .issue,
  );
export const useUpdateIssue = (iid: string) =>
  useIssueMutation((input: UpdateIssueInput) =>
    api(`/issues/${iid}`, { method: 'PATCH', body: input }),
  );
export const useSetIssueLabels = (iid: string) =>
  useIssueMutation((labelIds: string[]) =>
    api(`/issues/${iid}/labels`, { method: 'PUT', body: { labelIds } }),
  );
export const useDeleteIssue = (iid: string) =>
  useIssueMutation(() => api(`/issues/${iid}`, { method: 'DELETE' }));
export const useRestoreIssue = (iid: string) =>
  useIssueMutation(() => api(`/issues/${iid}/restore`, { method: 'POST' }));
export const useWatch = (iid: string) =>
  useIssueMutation((watching: boolean) =>
    api(`/issues/${iid}/watch`, { method: watching ? 'POST' : 'DELETE' }),
  );
export const useAddComment = (iid: string) =>
  useIssueMutation((body: string) =>
    api(`/issues/${iid}/comments`, { method: 'POST', body: { body } }),
  );
export const useEditComment = () =>
  useIssueMutation(({ id, body }: { id: string; body: string }) =>
    api(`/comments/${id}`, { method: 'PATCH', body: { body } }),
  );
export const useDeleteComment = () =>
  useIssueMutation((id: string) => api(`/comments/${id}`, { method: 'DELETE' }));
export const useModerateComment = () =>
  useIssueMutation(({ id, reason }: { id: string; reason: string }) =>
    api(`/comments/${id}/moderate`, { method: 'POST', body: { reason } }),
  );
export const useCreateLabel = (pid: string) =>
  useIssueMutation((input: { name: string; color: string }) =>
    api(`/projects/${pid}/labels`, { method: 'POST', body: input }),
  );
export const useDeleteLabel = () =>
  useIssueMutation((id: string) => api(`/labels/${id}`, { method: 'DELETE' }));
